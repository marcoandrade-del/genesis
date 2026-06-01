import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosDotacaoDespesa = {
  unidadeOrcamentariaId: string
  funcaoId: string
  subfuncaoId: string
  programaId: string
  acaoId: string
  contaDespesaEntidadeId: string
  fonteRecursoEntidadeId: string
  valorAutorizado: string | number
}

/**
 * Dotação de despesa: linha LOA com TODAS as 7 dimensões do padrão SIAFI cheio
 * obrigatórias. Operações bloqueadas quando o orçamento dono está em execução.
 */
export class DotacoesDespesaService {
  constructor(private prisma: PrismaClient) {}

  listar(orcamentoId: string) {
    return this.prisma.dotacaoDespesa.findMany({
      where: { orcamentoId },
      include: {
        unidadeOrcamentaria: true,
        funcao: true,
        subfuncao: true,
        programa: true,
        acao: true,
        contaDespesa: true,
        fonteRecurso: true,
      },
      orderBy: { criadoEm: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.dotacaoDespesa.findUnique({ where: { id } })
  }

  async criar(orcamentoId: string, dados: DadosDotacaoDespesa) {
    const { valor, ids } = this.validar(dados)
    const orcamento = await this.carregarOrcamentoEditavel(orcamentoId)
    await this.validarReferencias(orcamento.entidadeId, orcamento.ano, ids)

    try {
      return await this.prisma.dotacaoDespesa.create({
        data: {
          orcamentoId,
          ...ids,
          valorAutorizado: valor,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          'Já existe uma dotação com a mesma combinação de UO + Função + Subfunção + Programa + Ação + Conta + Fonte neste orçamento.',
        )
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosDotacaoDespesa) {
    const existente = await this.prisma.dotacaoDespesa.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Dotação não encontrada.')
    const { valor, ids } = this.validar(dados)
    const orcamento = await this.carregarOrcamentoEditavel(existente.orcamentoId)
    await this.validarReferencias(orcamento.entidadeId, orcamento.ano, ids)

    try {
      return await this.prisma.dotacaoDespesa.update({
        where: { id },
        data: { ...ids, valorAutorizado: valor },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          'Já existe uma dotação com a mesma combinação de dimensões neste orçamento.',
        )
      }
      throw e
    }
  }

  async excluir(id: string) {
    const existente = await this.prisma.dotacaoDespesa.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Dotação não encontrada.')
    await this.carregarOrcamentoEditavel(existente.orcamentoId)
    await this.prisma.dotacaoDespesa.delete({ where: { id } })
  }

  private validar(dados: DadosDotacaoDespesa) {
    const campos = [
      'unidadeOrcamentariaId',
      'funcaoId',
      'subfuncaoId',
      'programaId',
      'acaoId',
      'contaDespesaEntidadeId',
      'fonteRecursoEntidadeId',
    ] as const
    for (const c of campos) {
      if (!dados[c] || typeof dados[c] !== 'string' || dados[c].trim() === '') {
        throw new ErroNegocio('REQUISICAO_INVALIDA', `Campo "${c}" é obrigatório.`)
      }
    }
    if (dados.valorAutorizado === null || dados.valorAutorizado === undefined || dados.valorAutorizado === '') {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor autorizado é obrigatório.')
    }
    let valor: Prisma.Decimal
    try {
      valor = new Prisma.Decimal(dados.valorAutorizado as Prisma.Decimal.Value)
    } catch {
      throw new ErroNegocio('REQUISICAO_INVALIDA', `Valor inválido: "${dados.valorAutorizado}".`)
    }
    if (valor.isNegative()) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor autorizado não pode ser negativo.')
    }
    return {
      valor,
      ids: {
        unidadeOrcamentariaId: dados.unidadeOrcamentariaId,
        funcaoId: dados.funcaoId,
        subfuncaoId: dados.subfuncaoId,
        programaId: dados.programaId,
        acaoId: dados.acaoId,
        contaDespesaEntidadeId: dados.contaDespesaEntidadeId,
        fonteRecursoEntidadeId: dados.fonteRecursoEntidadeId,
      },
    }
  }

  private async carregarOrcamentoEditavel(orcamentoId: string) {
    const orc = await this.prisma.orcamento.findUnique({ where: { id: orcamentoId } })
    if (!orc) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    if (orc.status !== 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'Dotações só podem ser editadas em orçamento RASCUNHO.')
    }
    return orc
  }

  private async validarReferencias(
    entidadeId: string,
    ano: number,
    ids: Omit<DadosDotacaoDespesa, 'valorAutorizado'>,
  ) {
    const [uo, sub, programa, acao, conta, fonte] = await Promise.all([
      this.prisma.unidadeOrcamentaria.findUnique({ where: { id: ids.unidadeOrcamentariaId } }),
      this.prisma.subfuncao.findUnique({ where: { id: ids.subfuncaoId } }),
      this.prisma.programa.findUnique({ where: { id: ids.programaId } }),
      this.prisma.acao.findUnique({ where: { id: ids.acaoId } }),
      this.prisma.contaDespesaEntidade.findUnique({ where: { id: ids.contaDespesaEntidadeId } }),
      this.prisma.fonteRecursoEntidade.findUnique({ where: { id: ids.fonteRecursoEntidadeId } }),
    ])
    if (!uo || uo.entidadeId !== entidadeId)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Unidade Orçamentária inválida para esta entidade.')
    if (!sub || sub.funcaoId !== ids.funcaoId)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Subfunção não pertence à função informada.')
    if (!programa || programa.entidadeId !== entidadeId || programa.ano !== ano)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Programa inválido para esta entidade/exercício.')
    if (!acao || acao.programaId !== programa.id)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Ação não pertence ao programa informado.')
    if (!conta || conta.entidadeId !== entidadeId || conta.ano !== ano)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Conta de despesa inválida para esta entidade/exercício.')
    if (!conta.admiteMovimento)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Use uma conta analítica (admite movimento).')
    if (!fonte || fonte.entidadeId !== entidadeId || fonte.ano !== ano)
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Fonte de recurso inválida para esta entidade/exercício.')
  }
}
