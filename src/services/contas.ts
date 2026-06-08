import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { SincronizadorContas } from './sincronizador-contas.js'

// PCASP Estendido municipal (TCE-PR) chega a 9 níveis: os 7 oficiais
// (Classe→Grupo→SubGrupo→Título→SubTítulo→Ítem→SubÍtem) + 2 desdobramentos
// estendidos do plano paranaense; valor casado com a importação do plano oficial.
export const NIVEL_MAX = 9

export type DadosCriarConta = {
  planoId: string
  codigo: string
  descricao: string
  parentId?: string | null
}

export type DadosAtualizarConta = {
  codigo?: string
  descricao?: string
  admiteMovimento?: boolean
}

/**
 * Service do plano de contas — núcleo das regras de hierarquia.
 *
 * Invariantes:
 *  1. nível 1..NIVEL_MAX, derivado do parent.
 *  2. Toda conta NASCE ANALÍTICA (admiteMovimento=true). Ao ganhar o primeiro
 *     filho vira SINTÉTICA (admiteMovimento=false); ao perder o último filho,
 *     volta a analítica. Ou seja: admiteMovimento=true ⟺ não tem filhos.
 *  3. Exclusão proibida quando há filhos OU LancamentoItem OU
 *     ResumoMensalConta != 0 OU SaldoInicialAno != 0.
 *  4. Código único por plano (FK do DB via @@unique).
 */
export class ContasService {
  constructor(private prisma: PrismaClient) {}

  private readonly sync = new SincronizadorContas()

  async listar(planoId: string) {
    return this.prisma.conta.findMany({
      where: { planoId },
      orderBy: { codigo: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.conta.findUnique({ where: { id } })
  }

  async criar(dados: DadosCriarConta) {
    const plano = await this.prisma.planoDeContas.findUnique({ where: { id: dados.planoId } })
    if (!plano) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Plano de contas não encontrado.')

    let nivel = 1
    if (dados.parentId) {
      const parent = await this.prisma.conta.findUnique({ where: { id: dados.parentId } })
      if (!parent) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta pai não encontrada.')
      if (parent.planoId !== dados.planoId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta pai pertence a outro plano.')
      }
      nivel = parent.nivel + 1
      if (nivel > NIVEL_MAX) {
        throw new ErroNegocio('CONFLITO', `Profundidade máxima de ${NIVEL_MAX} níveis excedida.`)
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const conta = await tx.conta.create({
          data: {
            planoId: dados.planoId,
            codigo: dados.codigo,
            descricao: dados.descricao,
            nivel,
            admiteMovimento: true, // toda conta nasce analítica
            parentId: dados.parentId ?? null,
          },
        })
        // ao ganhar um filho, o pai deixa de admitir movimento (vira sintética)
        if (conta.parentId) await tx.conta.update({ where: { id: conta.parentId }, data: { admiteMovimento: false } })
        await this.sync.contaCriada(tx, 'CONTABIL', conta, { ano: plano.ano, modeloContabilId: plano.modeloContabilId })
        return conta
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma conta com o código "${dados.codigo}" neste plano.`)
      }
      throw e
    }
  }

  /**
   * Atualiza codigo / descricao / admiteMovimento. O parent é imutável aqui
   * — mover conta entre pais reorganiza a hierarquia e exige operação dedicada.
   */
  async atualizar(id: string, dados: DadosAtualizarConta) {
    const conta = await this.prisma.conta.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')

    // Marcar admiteMovimento=true (analítica) exige que a conta não tenha filhos.
    if (dados.admiteMovimento === true && conta.admiteMovimento === false) {
      const filhos = await this.prisma.conta.count({ where: { parentId: id } })
      if (filhos > 0) {
        throw new ErroNegocio('CONFLITO', 'Conta com filhos não pode admitir movimento.')
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const atualizada = await tx.conta.update({ where: { id }, data: dados })
        await this.sync.contaAtualizada(tx, 'CONTABIL', atualizada)
        return atualizada
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Já existe uma conta com esse código neste plano.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
      }
      throw e
    }
  }

  async excluir(id: string) {
    const conta = await this.prisma.conta.findUnique({ where: { id } })
    if (!conta) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')

    const [filhos, lancs, resumos, saldos] = await Promise.all([
      this.prisma.conta.count({ where: { parentId: id } }),
      this.prisma.lancamentoItem.count({ where: { contaId: id } }),
      this.prisma.resumoMensalConta.count({ where: { contaId: id } }),
      this.prisma.saldoInicialAno.count({ where: { contaId: id } }),
    ])

    if (filhos > 0) {
      throw new ErroNegocio('CONFLITO', `Conta com ${filhos} filho(s) não pode ser excluída.`)
    }
    if (lancs + resumos + saldos > 0) {
      throw new ErroNegocio(
        'CONFLITO',
        `Conta com movimentação contábil não pode ser excluída (lançamentos=${lancs}, resumos=${resumos}, saldos=${saldos}).`,
      )
    }

    await this.prisma.$transaction(async (tx) => {
      await this.sync.contaExcluida(tx, 'CONTABIL', id)
      await tx.conta.delete({ where: { id } })
      // se o pai ficou sem filhos, volta a ser analítica
      if (conta.parentId) {
        const irmaos = await tx.conta.count({ where: { parentId: conta.parentId } })
        if (irmaos === 0) {
          await tx.conta.update({ where: { id: conta.parentId }, data: { admiteMovimento: true } })
          await this.sync.contaReanalitizada(tx, 'CONTABIL', conta.parentId)
        }
      }
    })
  }
}
