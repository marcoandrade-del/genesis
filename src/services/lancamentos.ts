import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

const TIPOS = ['DEBITO', 'CREDITO'] as const
export type TipoLancamento = (typeof TIPOS)[number]

export type ItemDado = { contaId: string; tipo: TipoLancamento; valor: string }

export type DadosCriarLancamento = {
  municipioId: string
  data: string // YYYY-MM-DD
  historico: string
  itens: ItemDado[]
  criadoPorId: string
}

export type FiltrosListagem = {
  dataInicio?: string
  dataFim?: string
}

const LIMITE_LISTAGEM = 500
const dec = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v)
const ZERO = dec(0)

/**
 * Lançamentos contábeis com partida dobrada.
 *
 * Invariantes mantidos:
 *  1. ∑ DEBITO = ∑ CREDITO em cada lançamento (e >= 1 item de cada tipo).
 *  2. Toda conta referenciada admite movimento (folha) e pertence ao plano
 *     vigente do município no ano da data.
 *  3. Criar/excluir atualiza ResumoMensalConta na mesma transação.
 *
 * Lançamentos são imutáveis: para corrigir, registra-se um contra-lançamento.
 */
export class LancamentosService {
  constructor(private prisma: PrismaClient) {}

  async listar(municipioId: string, filtros: FiltrosListagem = {}) {
    const where: Prisma.LancamentoWhereInput = { municipioId }
    if (filtros.dataInicio || filtros.dataFim) {
      where.data = {}
      if (filtros.dataInicio) where.data.gte = new Date(filtros.dataInicio)
      if (filtros.dataFim) where.data.lte = new Date(filtros.dataFim)
    }
    return this.prisma.lancamento.findMany({
      where,
      orderBy: [{ data: 'desc' }, { criadoEm: 'desc' }],
      take: LIMITE_LISTAGEM,
    })
  }

  buscarPorId(id: string) {
    return this.prisma.lancamento.findUnique({
      where: { id },
      include: { itens: { orderBy: { tipo: 'asc' } } },
    })
  }

  async criar(dados: DadosCriarLancamento) {
    const { ano, mes } = extrairAnoMes(dados.data)

    if (!dados.itens || dados.itens.length < 2) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'Lançamento exige ao menos 1 débito e 1 crédito.')
    }
    const temDebito = dados.itens.some((i) => i.tipo === 'DEBITO')
    const temCredito = dados.itens.some((i) => i.tipo === 'CREDITO')
    if (!temDebito || !temCredito) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'Lançamento exige ao menos 1 débito e 1 crédito.')
    }

    // Soma de débitos = soma de créditos (Prisma.Decimal evita erro de float).
    const somaD = dados.itens.filter((i) => i.tipo === 'DEBITO').reduce((s, i) => s.plus(dec(i.valor)), ZERO)
    const somaC = dados.itens.filter((i) => i.tipo === 'CREDITO').reduce((s, i) => s.plus(dec(i.valor)), ZERO)
    if (!somaD.equals(somaC)) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Lançamento desbalanceado: débitos=${somaD}, créditos=${somaC}.`)
    }
    if (somaD.isZero()) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'Valor total do lançamento não pode ser zero.')
    }

    // Resolver município, modelo efetivo (próprio ou herdado do estado) e plano do ano.
    const municipio = await this.prisma.municipio.findUnique({
      where: { id: dados.municipioId },
      include: { estado: { select: { modeloContabilId: true } } },
    })
    if (!municipio) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Município não encontrado.')

    const modeloEfetivoId = municipio.modeloContabilId ?? municipio.estado.modeloContabilId
    if (!modeloEfetivoId) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        'Município (e seu estado) não têm modelo contábil definido.',
      )
    }

    const plano = await this.prisma.planoDeContas.findFirst({
      where: { modeloContabilId: modeloEfetivoId, ano },
    })
    if (!plano) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `Nenhum plano de contas vigente para o ano ${ano} no modelo do município.`,
      )
    }

    // Valida cada conta: existe, é do plano vigente, admite movimento.
    const contaIds = [...new Set(dados.itens.map((i) => i.contaId))]
    const contas = await this.prisma.conta.findMany({ where: { id: { in: contaIds } } })
    const porId = new Map(contas.map((c) => [c.id, c]))
    for (const id of contaIds) {
      const c = porId.get(id)
      if (!c) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', `Conta "${id}" não encontrada.`)
      if (c.planoId !== plano.id) {
        throw new ErroNegocio(
          'ENTIDADE_NAO_PROCESSAVEL',
          `Conta "${c.codigo}" pertence a outro plano. Use as contas do plano vigente para ${ano}.`,
        )
      }
      if (!c.admiteMovimento) {
        throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', `Conta "${c.codigo}" não admite movimento.`)
      }
    }

    // Colapsa itens por (contaId, tipo) — soma. Mesma conta pode aparecer com
    // débito E crédito em lançamentos compostos; agregamos antes do upsert.
    const totaisPorConta = new Map<string, { debito: Prisma.Decimal; credito: Prisma.Decimal }>()
    for (const i of dados.itens) {
      const t = totaisPorConta.get(i.contaId) ?? { debito: ZERO, credito: ZERO }
      if (i.tipo === 'DEBITO') t.debito = t.debito.plus(dec(i.valor))
      else t.credito = t.credito.plus(dec(i.valor))
      totaisPorConta.set(i.contaId, t)
    }

    return this.prisma.$transaction(async (tx) => {
      const lanc = await tx.lancamento.create({
        data: {
          municipioId: dados.municipioId,
          data: new Date(dados.data),
          historico: dados.historico,
          valor: somaD,
          criadoPorId: dados.criadoPorId,
        },
      })

      await tx.lancamentoItem.createMany({
        data: dados.itens.map((i) => ({
          lancamentoId: lanc.id,
          contaId: i.contaId,
          tipo: i.tipo,
          valor: dec(i.valor),
        })),
      })

      for (const [contaId, { debito, credito }] of totaisPorConta) {
        await tx.resumoMensalConta.upsert({
          where: { municipioId_contaId_ano_mes: { municipioId: dados.municipioId, contaId, ano, mes } },
          create: { municipioId: dados.municipioId, contaId, ano, mes, totalDebito: debito, totalCredito: credito },
          update: { totalDebito: { increment: debito }, totalCredito: { increment: credito } },
        })
      }

      return lanc
    })
  }

  async excluir(id: string) {
    const lanc = await this.prisma.lancamento.findUnique({
      where: { id },
      include: { itens: true },
    })
    if (!lanc) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Lançamento não encontrado.')

    const ano = lanc.data.getUTCFullYear()
    const mes = lanc.data.getUTCMonth() + 1

    const totaisPorConta = new Map<string, { debito: Prisma.Decimal; credito: Prisma.Decimal }>()
    for (const i of lanc.itens) {
      const t = totaisPorConta.get(i.contaId) ?? { debito: ZERO, credito: ZERO }
      if (i.tipo === 'DEBITO') t.debito = t.debito.plus(dec(i.valor))
      else t.credito = t.credito.plus(dec(i.valor))
      totaisPorConta.set(i.contaId, t)
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [contaId, { debito, credito }] of totaisPorConta) {
        await tx.resumoMensalConta.update({
          where: { municipioId_contaId_ano_mes: { municipioId: lanc.municipioId, contaId, ano, mes } },
          data: { totalDebito: { decrement: debito }, totalCredito: { decrement: credito } },
        })
      }
      // onDelete: Cascade no schema limpa LancamentoItem automaticamente.
      await tx.lancamento.delete({ where: { id } })
    })
  }
}

/** Extrai ano/mês da string ISO 'YYYY-MM-DD' sem passar por Date (evita timezone). */
export function extrairAnoMes(dataStr: string): { ano: number; mes: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataStr)
  if (!m) throw new ErroNegocio('REQUISICAO_INVALIDA', `Data inválida: "${dataStr}". Use YYYY-MM-DD.`)
  return { ano: Number(m[1]), mes: Number(m[2]) }
}
