import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosLancamentoEvento = {
  contaDebitoMascara: string
  contaCreditoMascara: string
}

export type DadosEvento = {
  codigo: string
  descricao: string
  tipoInscricao?: string | null
  classificacaoContabilMascara?: string | null
  classificacaoOrcamentariaMascara?: string | null
  ativo?: boolean
  lancamentos: DadosLancamentoEvento[]
}

/**
 * Tabela de Eventos Contábeis — biblioteca de regras de contabilização.
 *
 * Cada evento descreve o "como contabilizar" um movimento de execução
 * orçamentária (empenho, liquidação, pagamento etc.). Quando disparado por
 * uma execução real, gera lançamentos contábeis substituindo as máscaras
 * (X/Y) pelos códigos efetivos. Os eventos vivem por modelo contábil (TCE);
 * lançamentos do evento são pares D-C com máscaras textuais.
 */
export class EventosContabeisService {
  constructor(private prisma: PrismaClient) {}

  listar(modeloContabilId: string) {
    return this.prisma.eventoContabil.findMany({
      where: { modeloContabilId },
      orderBy: { codigo: 'asc' },
      include: { lancamentos: { orderBy: { ordem: 'asc' } } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.eventoContabil.findUnique({
      where: { id },
      include: { lancamentos: { orderBy: { ordem: 'asc' } } },
    })
  }

  async criar(modeloContabilId: string, dados: DadosEvento) {
    this.validarDados(dados)

    const modelo = await this.prisma.modeloContabil.findUnique({ where: { id: modeloContabilId } })
    if (!modelo) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Modelo contábil não encontrado.')

    const codigo = dados.codigo.trim()

    try {
      return await this.prisma.$transaction(async (tx) => {
        const evento = await tx.eventoContabil.create({
          data: {
            modeloContabilId,
            codigo,
            descricao: dados.descricao.trim(),
            tipoInscricao: trimOuNull(dados.tipoInscricao),
            classificacaoContabilMascara: trimOuNull(dados.classificacaoContabilMascara),
            classificacaoOrcamentariaMascara: trimOuNull(dados.classificacaoOrcamentariaMascara),
            ativo: dados.ativo ?? true,
          },
        })
        await tx.eventoLancamento.createMany({
          data: dados.lancamentos.map((l, i) => ({
            eventoId: evento.id,
            ordem: i + 1,
            contaDebitoMascara: l.contaDebitoMascara.trim(),
            contaCreditoMascara: l.contaCreditoMascara.trim(),
          })),
        })
        return evento
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um evento com o código "${codigo}" neste modelo.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosEvento) {
    this.validarDados(dados)

    const existente = await this.prisma.eventoContabil.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Evento não encontrado.')

    const codigo = dados.codigo.trim()

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Substitui os lançamentos integralmente — mais simples que diff.
        await tx.eventoLancamento.deleteMany({ where: { eventoId: id } })
        const evento = await tx.eventoContabil.update({
          where: { id },
          data: {
            codigo,
            descricao: dados.descricao.trim(),
            tipoInscricao: trimOuNull(dados.tipoInscricao),
            classificacaoContabilMascara: trimOuNull(dados.classificacaoContabilMascara),
            classificacaoOrcamentariaMascara: trimOuNull(dados.classificacaoOrcamentariaMascara),
            ativo: dados.ativo ?? existente.ativo,
          },
        })
        await tx.eventoLancamento.createMany({
          data: dados.lancamentos.map((l, i) => ({
            eventoId: id,
            ordem: i + 1,
            contaDebitoMascara: l.contaDebitoMascara.trim(),
            contaCreditoMascara: l.contaCreditoMascara.trim(),
          })),
        })
        return evento
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um evento com o código "${codigo}" neste modelo.`)
      }
      throw e
    }
  }

  async excluir(id: string) {
    const ev = await this.prisma.eventoContabil.findUnique({ where: { id } })
    if (!ev) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Evento não encontrado.')
    // onDelete: Cascade limpa os lançamentos automaticamente.
    await this.prisma.eventoContabil.delete({ where: { id } })
  }

  private validarDados(dados: DadosEvento) {
    if (!dados.codigo?.trim()) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Código é obrigatório.')
    }
    if (!dados.descricao?.trim()) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Descrição é obrigatória.')
    }
    if (!Array.isArray(dados.lancamentos) || dados.lancamentos.length === 0) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Inclua ao menos um par débito/crédito.')
    }
    for (const l of dados.lancamentos) {
      if (!l.contaDebitoMascara?.trim() || !l.contaCreditoMascara?.trim()) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Todos os pares precisam ter conta débito e conta crédito.')
      }
    }
  }
}

function trimOuNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}
