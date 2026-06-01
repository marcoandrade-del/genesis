import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosPrevisaoReceita = {
  contaReceitaEntidadeId: string
  fonteRecursoEntidadeId: string
  valorPrevisto: string | number
}

/**
 * Previsão de receita LOA por (ContaReceita × Fonte). Sem outras dimensões.
 * Bloqueada para edição quando o orçamento não está em RASCUNHO.
 */
export class PrevisoesReceitaService {
  constructor(private prisma: PrismaClient) {}

  listar(orcamentoId: string) {
    return this.prisma.previsaoReceita.findMany({
      where: { orcamentoId },
      include: { contaReceita: true, fonteRecurso: true },
      orderBy: { criadoEm: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.previsaoReceita.findUnique({ where: { id } })
  }

  async criar(orcamentoId: string, dados: DadosPrevisaoReceita) {
    const { valor, ids } = this.validar(dados)
    const orcamento = await this.carregarOrcamentoEditavel(orcamentoId)
    await this.validarReferencias(orcamento.entidadeId, orcamento.ano, ids)

    try {
      return await this.prisma.previsaoReceita.create({
        data: { orcamentoId, ...ids, valorPrevisto: valor },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          'Já existe uma previsão com a mesma combinação de Conta + Fonte neste orçamento.',
        )
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosPrevisaoReceita) {
    const existente = await this.prisma.previsaoReceita.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Previsão não encontrada.')
    const { valor, ids } = this.validar(dados)
    const orcamento = await this.carregarOrcamentoEditavel(existente.orcamentoId)
    await this.validarReferencias(orcamento.entidadeId, orcamento.ano, ids)

    try {
      return await this.prisma.previsaoReceita.update({
        where: { id },
        data: { ...ids, valorPrevisto: valor },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          'Já existe uma previsão com a mesma combinação de Conta + Fonte neste orçamento.',
        )
      }
      throw e
    }
  }

  async excluir(id: string) {
    const existente = await this.prisma.previsaoReceita.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Previsão não encontrada.')
    await this.carregarOrcamentoEditavel(existente.orcamentoId)
    await this.prisma.previsaoReceita.delete({ where: { id } })
  }

  private validar(dados: DadosPrevisaoReceita) {
    for (const c of ['contaReceitaEntidadeId', 'fonteRecursoEntidadeId'] as const) {
      if (!dados[c] || typeof dados[c] !== 'string' || dados[c].trim() === '') {
        throw new ErroNegocio('REQUISICAO_INVALIDA', `Campo "${c}" é obrigatório.`)
      }
    }
    if (dados.valorPrevisto === null || dados.valorPrevisto === undefined || dados.valorPrevisto === '') {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor previsto é obrigatório.')
    }
    let valor: Prisma.Decimal
    try {
      valor = new Prisma.Decimal(dados.valorPrevisto as Prisma.Decimal.Value)
    } catch {
      throw new ErroNegocio('REQUISICAO_INVALIDA', `Valor inválido: "${dados.valorPrevisto}".`)
    }
    if (valor.isNegative()) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor previsto não pode ser negativo.')
    }
    return {
      valor,
      ids: {
        contaReceitaEntidadeId: dados.contaReceitaEntidadeId,
        fonteRecursoEntidadeId: dados.fonteRecursoEntidadeId,
      },
    }
  }

  private async carregarOrcamentoEditavel(orcamentoId: string) {
    const orc = await this.prisma.orcamento.findUnique({ where: { id: orcamentoId } })
    if (!orc) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    if (orc.status !== 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'Previsões só podem ser editadas em orçamento RASCUNHO.')
    }
    return orc
  }

  private async validarReferencias(
    entidadeId: string,
    ano: number,
    ids: { contaReceitaEntidadeId: string; fonteRecursoEntidadeId: string },
  ) {
    const [conta, fonte] = await Promise.all([
      this.prisma.contaReceitaEntidade.findUnique({ where: { id: ids.contaReceitaEntidadeId } }),
      this.prisma.fonteRecursoEntidade.findUnique({ where: { id: ids.fonteRecursoEntidadeId } }),
    ])
    if (!conta || conta.entidadeId !== entidadeId || conta.ano !== ano)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta de receita inválida para esta entidade/exercício.')
    if (!conta.admiteMovimento)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Use uma conta analítica (admite movimento).')
    if (!fonte || fonte.entidadeId !== entidadeId || fonte.ano !== ano)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Fonte de recurso inválida para esta entidade/exercício.')
  }
}
