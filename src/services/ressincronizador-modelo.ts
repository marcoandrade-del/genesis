import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

/**
 * Ressincronização em massa modelo→entidades.
 *
 * Por que existe: o onboarding (`EntidadeService.criar`) copia o modelo vigente
 * no momento da criação, e o `SincronizadorContas` propaga edições conta-a-conta
 * feitas no admin. Mas a IMPORTAÇÃO EM MASSA do modelo (scripts de PCASP/
 * orçamentário, `createMany`) NÃO passa pelo sincronizador — então entidades
 * onboardadas antes da importação ficam com cópias defasadas. Este service
 * recopia o modelo atual do estado para as entidades que estão nesse estado.
 *
 * Segurança (cláusula pétrea + execução): só recopia entidades cujas cópias são
 * 100% `origem=MODELO` e SEM execução (lançamento/orçamento). Se a entidade tem
 * desdobramento ou execução, é **pulada** (preservada) — o sync incremental
 * (`SincronizadorContas`) já cobre edições conta-a-conta nesse caso.
 *
 * Idempotente: rodar de novo numa entidade já em dia recria as mesmas cópias.
 */

export type StatusEntidade = 'ressincronizada' | 'pulada' | 'sem-modelo'

export type ResumoEntidade = {
  entidadeId: string
  nome: string
  status: StatusEntidade
  motivo?: string
  /** Totais recopiados (somados sobre todos os exercícios da entidade). */
  contabil: number
  receita: number
  despesa: number
  fontes: number
}

export type ResumoLote = {
  total: number
  ressincronizadas: number
  puladas: number
  semModelo: number
  entidades: ResumoEntidade[]
}

/** Frase curta para toast/CLI a partir de um resumo de lote. */
export function descreverResumo(r: ResumoLote): string {
  if (r.total === 0) return 'Nenhuma entidade encontrada para ressincronizar.'
  const partes = [`${r.ressincronizadas} ressincronizada(s)`]
  if (r.puladas) partes.push(`${r.puladas} pulada(s) (têm desdobramento/execução — preservadas)`)
  if (r.semModelo) partes.push(`${r.semModelo} sem modelo contábil`)
  return `${r.total} entidade(s): ${partes.join('; ')}.`
}

type ContaModelo = { id: string; codigo: string; descricao: string; nivel: number; admiteMovimento: boolean; parentId: string | null }

// O modelo real (PCASP estendido) chega a ~8.7k contas. Um único INSERT estoura
// o limite de ~65535 parâmetros do Postgres, então insere em lotes.
const LOTE = 1000

/** Constrói o `createMany.data` de uma árvore de entidade a partir das contas do
 * modelo: ids novos e `parentId` remapeado (modelo → cópia). origem=MODELO.
 * Mesma semântica de `EntidadeService.criar`. */
function copiarArvore(contas: ContaModelo[], entidadeId: string, ano: number) {
  const idNovo = new Map<string, string>(contas.map((c) => [c.id, randomUUID()]))
  return contas.map((c) => ({
    id: idNovo.get(c.id)!,
    entidadeId,
    ano,
    codigo: c.codigo,
    descricao: c.descricao,
    nivel: c.nivel,
    admiteMovimento: c.admiteMovimento,
    origem: 'MODELO' as const,
    modeloContaId: c.id,
    parentId: c.parentId ? idNovo.get(c.parentId)! : null,
  }))
}

type CreateManyDelegate = { createMany: (args: { data: unknown[] }) => Promise<unknown> }
async function createManyEmLotes(delegate: CreateManyDelegate, linhas: unknown[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += LOTE) {
    await delegate.createMany({ data: linhas.slice(i, i + LOTE) })
  }
}

export class RessincronizadorModelo {
  constructor(private prisma: PrismaClient) {}

  /**
   * Recopia o modelo do estado para UMA entidade, em todos os exercícios que ela
   * já tem cópias. Pula (sem escrever) se houver desdobramento ou execução.
   */
  async ressincronizarEntidade(entidadeId: string): Promise<ResumoEntidade> {
    const entidade = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { modeloContabilId: true } } } } },
    })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    const resumo: ResumoEntidade = {
      entidadeId,
      nome: entidade.nome,
      status: 'ressincronizada',
      contabil: 0,
      receita: 0,
      despesa: 0,
      fontes: 0,
    }

    const modeloId = entidade.municipio.modeloContabilId ?? entidade.municipio.estado.modeloContabilId
    if (!modeloId) return { ...resumo, status: 'sem-modelo', motivo: 'Município (e estado) sem modelo contábil definido.' }

    // Guarda: preserva trabalho local. Qualquer desdobramento ou execução → pula.
    const [desdC, desdR, desdD, desdF, lanc, orc] = await Promise.all([
      this.prisma.contaContabilEntidade.count({ where: { entidadeId, origem: 'DESDOBRAMENTO' } }),
      this.prisma.contaReceitaEntidade.count({ where: { entidadeId, origem: 'DESDOBRAMENTO' } }),
      this.prisma.contaDespesaEntidade.count({ where: { entidadeId, origem: 'DESDOBRAMENTO' } }),
      this.prisma.fonteRecursoEntidade.count({ where: { entidadeId, origem: 'DESDOBRAMENTO' } }),
      this.prisma.lancamento.count({ where: { entidadeId } }),
      this.prisma.orcamento.count({ where: { entidadeId } }),
    ])
    const desdobramentos = desdC + desdR + desdD + desdF
    if (desdobramentos > 0 || lanc > 0 || orc > 0) {
      return {
        ...resumo,
        status: 'pulada',
        motivo: `Preservada: ${desdobramentos} desdobramento(s), ${lanc} lançamento(s), ${orc} orçamento(s). Use o sync incremental.`,
      }
    }

    for (const ano of await this.anosComCopias(entidadeId)) {
      const [planoCont, planoRec, planoDesp, fontes] = await Promise.all([
        this.prisma.planoDeContas.findFirst({ where: { modeloContabilId: modeloId, ano } }),
        this.prisma.planoContasReceita.findFirst({ where: { modeloContabilId: modeloId, ano } }),
        this.prisma.planoContasDespesa.findFirst({ where: { modeloContabilId: modeloId, ano } }),
        this.prisma.fonteRecurso.findMany({ where: { modeloContabilId: modeloId, ano } }),
      ])
      const [contasCont, contasRec, contasDesp] = await Promise.all([
        planoCont ? this.prisma.conta.findMany({ where: { planoId: planoCont.id }, orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
        planoRec ? this.prisma.contaReceita.findMany({ where: { planoId: planoRec.id }, orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
        planoDesp ? this.prisma.contaDespesa.findMany({ where: { planoId: planoDesp.id }, orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
      ])

      // Só toca um plano-tipo se o modelo TEM esse plano para o ano — não apaga
      // cópia órfã sem ter como restaurá-la.
      await this.prisma.$transaction(async (tx) => {
        if (planoCont) {
          await tx.contaContabilEntidade.deleteMany({ where: { entidadeId, ano, origem: 'MODELO' } })
          await createManyEmLotes(tx.contaContabilEntidade, copiarArvore(contasCont, entidadeId, ano))
        }
        if (planoRec) {
          await tx.contaReceitaEntidade.deleteMany({ where: { entidadeId, ano, origem: 'MODELO' } })
          await createManyEmLotes(tx.contaReceitaEntidade, copiarArvore(contasRec, entidadeId, ano))
        }
        if (planoDesp) {
          await tx.contaDespesaEntidade.deleteMany({ where: { entidadeId, ano, origem: 'MODELO' } })
          await createManyEmLotes(tx.contaDespesaEntidade, copiarArvore(contasDesp, entidadeId, ano))
        }
        if (fontes.length) {
          await tx.fonteRecursoEntidade.deleteMany({ where: { entidadeId, ano, origem: 'MODELO' } })
          await tx.fonteRecursoEntidade.createMany({
            data: fontes.map((f) => ({
              entidadeId,
              ano,
              codigo: f.codigo,
              nomenclatura: f.nomenclatura,
              especificacao: f.especificacao,
              vinculada: f.vinculada,
              grupo: f.grupo,
              origem: 'MODELO' as const,
              modeloFonteId: f.id,
            })),
          })
        }
      }, { timeout: 120_000 })

      resumo.contabil += contasCont.length
      resumo.receita += contasRec.length
      resumo.despesa += contasDesp.length
      resumo.fontes += fontes.length
    }

    return resumo
  }

  /** Ressincroniza todas as entidades de um município. */
  async ressincronizarMunicipio(municipioId: string): Promise<ResumoLote> {
    const municipio = await this.prisma.municipio.findUnique({ where: { id: municipioId } })
    if (!municipio) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Município não encontrado.')
    const entidades = await this.prisma.entidade.findMany({
      where: { municipioId },
      orderBy: { nome: 'asc' },
      select: { id: true },
    })
    return this.processarLote(entidades.map((e) => e.id))
  }

  /** Ressincroniza todas as entidades de todos os municípios de um estado. */
  async ressincronizarEstado(estadoId: string): Promise<ResumoLote> {
    const estado = await this.prisma.estado.findUnique({ where: { id: estadoId } })
    if (!estado) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Estado não encontrado.')
    const entidades = await this.prisma.entidade.findMany({
      where: { municipio: { estadoId } },
      orderBy: { nome: 'asc' },
      select: { id: true },
    })
    return this.processarLote(entidades.map((e) => e.id))
  }

  // Processa uma a uma (cada entidade tem sua própria transação — uma falha não
  // arrasta as outras nem segura todas num lock único).
  private async processarLote(ids: string[]): Promise<ResumoLote> {
    const entidades: ResumoEntidade[] = []
    for (const id of ids) entidades.push(await this.ressincronizarEntidade(id))
    return {
      total: entidades.length,
      ressincronizadas: entidades.filter((e) => e.status === 'ressincronizada').length,
      puladas: entidades.filter((e) => e.status === 'pulada').length,
      semModelo: entidades.filter((e) => e.status === 'sem-modelo').length,
      entidades,
    }
  }

  // Exercícios para os quais a entidade tem ao menos uma cópia (qualquer plano).
  private async anosComCopias(entidadeId: string): Promise<number[]> {
    const sel = { where: { entidadeId }, distinct: ['ano'] as const, select: { ano: true } }
    const [c, r, d, f] = await Promise.all([
      this.prisma.contaContabilEntidade.findMany(sel),
      this.prisma.contaReceitaEntidade.findMany(sel),
      this.prisma.contaDespesaEntidade.findMany(sel),
      this.prisma.fonteRecursoEntidade.findMany(sel),
    ])
    const anos = new Set<number>()
    for (const row of [...c, ...r, ...d, ...f]) anos.add(row.ano)
    return [...anos].sort((a, b) => a - b)
  }
}
