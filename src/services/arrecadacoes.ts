import { PrismaClient, Prisma, type ArrecadacaoTipo } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export interface DadosArrecadacao {
  previsaoId: string
  tipo: string // 'ARRECADACAO' | 'ESTORNO'
  data: string // yyyy-mm-dd
  valor: string
  historico?: string
}

export interface LinhaArrecadacao {
  id: string
  codigo: string
  rotulo: string
  nivel: number
  previsto: number
  arrecadado: number
  saldo: number
}

export interface ResumoArrecadacao {
  temOrcamento: boolean
  resumo: { previsto: number; arrecadado: number; saldo: number }
  porFonte: LinhaArrecadacao[]
  porConta: LinhaArrecadacao[]
}

const TIPOS_VALIDOS = ['ARRECADACAO', 'ESTORNO']

/** Arredonda para centavos, evitando deriva de ponto flutuante na soma. */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Arrecadação da receita (gap #5 PR-3). Movimento sobre uma previsão (conta
 * analítica × fonte) do orçamento APROVADO; ESTORNO reverte. O acumulado vive
 * materializado em `PrevisaoReceita.valorArrecadado`, atualizado na mesma
 * transação do movimento (espelha o padrão de `DotacaoDespesa`). Movimento é
 * imutável após criado — correção é por estorno, preservando a trilha.
 */
export class ArrecadacoesService {
  constructor(private prisma: PrismaClient) {}

  /** Movimentos do orçamento, mais recentes primeiro. */
  listar(orcamentoId: string) {
    return this.prisma.arrecadacao.findMany({
      where: { previsao: { orcamentoId } },
      orderBy: [{ data: 'desc' }, { criadoEm: 'desc' }],
      include: { previsao: { include: { contaReceita: true, fonteRecurso: true } } },
    })
  }

  async criar(orcamentoId: string, dados: DadosArrecadacao) {
    const orcamento = await this.prisma.orcamento.findUnique({ where: { id: orcamentoId } })
    if (!orcamento) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Orçamento não encontrado.')
    if (orcamento.status === 'RASCUNHO') {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'O orçamento ainda está em rascunho — aprove-o antes de registrar arrecadações.')
    }

    if (!dados.previsaoId?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Selecione a previsão (conta × fonte).')
    if (!TIPOS_VALIDOS.includes(dados.tipo)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo de movimento inválido.')
    if (!dados.data?.trim() || Number.isNaN(Date.parse(dados.data))) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe uma data válida.')
    }
    const n = Number(dados.valor)
    if (!Number.isFinite(n) || n <= 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor deve ser positivo.')
    const valor = new Prisma.Decimal(dados.valor)

    const previsao = await this.prisma.previsaoReceita.findUnique({ where: { id: dados.previsaoId.trim() } })
    if (!previsao || previsao.orcamentoId !== orcamentoId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'A previsão não pertence a este orçamento.')
    }
    // Estorno não pode deixar o arrecadado da previsão negativo.
    if (dados.tipo === 'ESTORNO' && valor.greaterThan(previsao.valorArrecadado)) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'O estorno excede o valor arrecadado desta previsão.')
    }

    return this.prisma.$transaction(async (tx) => {
      const mov = await tx.arrecadacao.create({
        data: {
          previsaoId: previsao.id,
          tipo: dados.tipo as ArrecadacaoTipo,
          data: new Date(dados.data),
          valor,
          historico: dados.historico?.trim() || null,
        },
      })
      await tx.previsaoReceita.update({
        where: { id: previsao.id },
        data: { valorArrecadado: dados.tipo === 'ARRECADACAO' ? { increment: valor } : { decrement: valor } },
      })
      return mov
    })
  }

  /**
   * Previsto × arrecadado do exercício: totais, por fonte (plano) e por conta
   * de receita COM roll-up (folha + ancestrais da árvore ContaReceitaEntidade)
   * — espelha o SaldoOrcamentarioService da despesa.
   */
  async resumo(entidadeId: string, ano: number): Promise<ResumoArrecadacao> {
    const vazio: ResumoArrecadacao = {
      temOrcamento: false,
      resumo: { previsto: 0, arrecadado: 0, saldo: 0 },
      porFonte: [],
      porConta: [],
    }
    const orcamento = await this.prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId, ano } } })
    if (!orcamento) return vazio

    const previsoes = await this.prisma.previsaoReceita.findMany({
      where: { orcamentoId: orcamento.id },
      include: { fonteRecurso: true },
    })

    const contas = await this.prisma.contaReceitaEntidade.findMany({
      where: { entidadeId, ano },
      select: { id: true, codigo: true, descricao: true, nivel: true, parentId: true },
    })
    const noPorId = new Map(contas.map((c) => [c.id, c]))

    let prevTotal = 0
    let arrTotal = 0
    const porFonte = new Map<string, { codigo: string; rotulo: string; previsto: number; arrecadado: number }>()
    const acumConta = new Map<string, { previsto: number; arrecadado: number }>()

    for (const p of previsoes) {
      const prev = Number(p.valorPrevisto)
      const arr = Number(p.valorArrecadado)
      prevTotal += prev
      arrTotal += arr

      const f = porFonte.get(p.fonteRecursoEntidadeId) ?? {
        codigo: p.fonteRecurso.codigo,
        rotulo: p.fonteRecurso.nomenclatura,
        previsto: 0,
        arrecadado: 0,
      }
      f.previsto += prev
      f.arrecadado += arr
      porFonte.set(p.fonteRecursoEntidadeId, f)

      // Roll-up na árvore de contas: a folha e todos os ancestrais recebem o valor.
      let id: string | null = p.contaReceitaEntidadeId
      const visitados = new Set<string>()
      while (id && !visitados.has(id)) {
        visitados.add(id)
        const node = noPorId.get(id)
        if (!node) break
        const acc = acumConta.get(id) ?? { previsto: 0, arrecadado: 0 }
        acc.previsto += prev
        acc.arrecadado += arr
        acumConta.set(id, acc)
        id = node.parentId
      }
    }

    const linha = (
      id: string,
      codigo: string,
      rotulo: string,
      nivel: number,
      v: { previsto: number; arrecadado: number },
    ): LinhaArrecadacao => ({
      id,
      codigo,
      rotulo,
      nivel,
      previsto: r2(v.previsto),
      arrecadado: r2(v.arrecadado),
      saldo: r2(v.previsto - v.arrecadado),
    })

    return {
      temOrcamento: true,
      resumo: { previsto: r2(prevTotal), arrecadado: r2(arrTotal), saldo: r2(prevTotal - arrTotal) },
      porFonte: [...porFonte.entries()]
        .map(([id, v]) => linha(id, v.codigo, v.rotulo, 0, v))
        .sort((a, b) => a.codigo.localeCompare(b.codigo)),
      porConta: contas
        .filter((c) => acumConta.has(c.id))
        .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))
        .map((c) => linha(c.id, c.codigo, c.descricao, c.nivel, acumConta.get(c.id)!)),
    }
  }
}
