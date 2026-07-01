/**
 * Classificação de FONTE DE RECURSO → FINALIDADE, parametrizável por Estado (TCE).
 *
 * É o eixo do controle de saldo por fonte exigido na prestação de contas (LRF +
 * Lei 4.320 + TCEs): saber quanto de receita/despesa está vinculado a Educação
 * (MDE), Saúde (ASPS), FUNDEB, RPPS, dívida, ou é livre. Espelha o padrão da RCL
 * (`src/services/rcl.ts`): default em código por Estado + override editável no
 * banco (`Estado.fonteClassificacao` JSON). Hoje é "aproximação por código de
 * fonte"; vira fiel quando importarmos o `cdFontePadrao` oficial do TCE-PR.
 *
 * ⚠️ Realidade dos dados (Maringá 2026): a RECEITA tem 72 fontes reais
 * (classificáveis); a DESPESA está 100% na fonte sintética 9999 ("não
 * discriminada") porque o portal não publicou fonte por dotação. Logo o saldo
 * por finalidade é real na receita e cai em "Não classificada" na despesa até o
 * QDD (fonte por dotação) ser importado. Ver [[contabil-regras-orcamentario]].
 */

/** Finalidades de fonte relevantes à prestação de contas. NAO_CLASSIFICADA = sem regra (honesto). */
export type Finalidade =
  | 'LIVRES'
  | 'MDE'
  | 'FUNDEB'
  | 'ASPS'
  | 'RPPS'
  | 'DIVIDA'
  | 'OUTRAS_VINCULADAS'
  | 'NAO_CLASSIFICADA'

/** Rótulo oficial de cada finalidade (exibição). */
export const ROTULO_FINALIDADE: Record<Finalidade, string> = {
  LIVRES: 'Recursos Ordinários (Livres)',
  MDE: 'Manutenção e Desenvolvimento do Ensino (MDE)',
  FUNDEB: 'FUNDEB',
  ASPS: 'Ações e Serviços Públicos de Saúde (ASPS)',
  RPPS: 'Regime Próprio de Previdência (RPPS)',
  DIVIDA: 'Operações de Crédito / Dívida',
  OUTRAS_VINCULADAS: 'Outras Vinculadas',
  NAO_CLASSIFICADA: 'Não classificada',
}

/** Ordem de exibição estável das finalidades nos demonstrativos. */
export const ORDEM_FINALIDADE: Finalidade[] = [
  'LIVRES',
  'MDE',
  'FUNDEB',
  'ASPS',
  'RPPS',
  'DIVIDA',
  'OUTRAS_VINCULADAS',
  'NAO_CLASSIFICADA',
]

const FINALIDADES_VALIDAS = new Set<string>(ORDEM_FINALIDADE)

/** Uma regra: a finalidade e os prefixos de código de fonte que a definem. */
export type RegraFonte = { finalidade: Finalidade; prefixos: string[] }

/** Composição editável da classificação de fontes. */
export type ClassificacaoFonte = { nome: string; regras: RegraFonte[] }

/** Default STN: sem regras (os códigos de fonte variam por TCE). */
export const CLASSIFICACAO_STN: ClassificacaoFonte = { nome: 'STN (padrão)', regras: [] }

/**
 * Composições por Estado (TCE). Deltas sobre a STN, com os prefixos de código de
 * fonte que cada TCE usa. PR validado contra a LOA real de Maringá 2026
 * (aproximação por código; será refinado por `cdFontePadrao` no import oficial).
 */
export const CLASSIFICACAO_POR_ESTADO: Record<string, ClassificacaoFonte> = {
  PR: {
    nome: 'TCE-PR (aproximação por código de fonte)',
    regras: [
      { finalidade: 'LIVRES', prefixos: ['1000', '11045', '1097', '1521'] },
      { finalidade: 'FUNDEB', prefixos: ['1101', '1102'] },
      { finalidade: 'MDE', prefixos: ['1103', '1104', '1107', '1274', '31120', '31138', '31150'] },
      {
        finalidade: 'ASPS',
        prefixos: [
          '1303', '1238', '1271', '1272', '1290', '1470', '1471', '1478', '1480',
          '1481', '1482', '1483', '1485', '1486', '1487', '1489', '31357',
        ],
      },
      { finalidade: 'DIVIDA', prefixos: ['1257', '41197', '41687', '41992', '41993'] },
    ],
  },
}

/** Resolve a composição pelo Estado (sigla); cai na STN se não houver delta. */
export function classificacaoDoEstado(sigla: string | null | undefined): ClassificacaoFonte {
  return (sigla && CLASSIFICACAO_POR_ESTADO[sigla]) || CLASSIFICACAO_STN
}

/** Valida o JSON da composição editável (vindo do banco). Retorna null se inválido/ausente. */
export function parseClassificacaoFonte(json: unknown): ClassificacaoFonte | null {
  if (!json || typeof json !== 'object') return null
  const o = json as { nome?: unknown; regras?: unknown }
  if (!Array.isArray(o.regras)) return null
  const regras: RegraFonte[] = []
  for (const r of o.regras) {
    if (!r || typeof r !== 'object') continue
    const rr = r as { finalidade?: unknown; prefixos?: unknown }
    if (typeof rr.finalidade !== 'string' || !FINALIDADES_VALIDAS.has(rr.finalidade)) continue
    const prefixos = Array.isArray(rr.prefixos) ? rr.prefixos.filter((p): p is string => typeof p === 'string' && !!p.trim()) : []
    if (prefixos.length === 0) continue
    regras.push({ finalidade: rr.finalidade as Finalidade, prefixos })
  }
  if (regras.length === 0) return null
  return { nome: typeof o.nome === 'string' && o.nome.trim() ? o.nome.trim() : 'Personalizada (Estado)', regras }
}

/**
 * Composição efetiva: a config EDITÁVEL do Estado (JSON do banco) tem prioridade;
 * sem ela, cai no default do código (delta do Estado ou STN).
 */
export function resolverClassificacaoFonte(sigla: string | null | undefined, estadoJson: unknown, modeloJson?: unknown): ClassificacaoFonte {
  return parseClassificacaoFonte(estadoJson) ?? parseClassificacaoFonte(modeloJson) ?? classificacaoDoEstado(sigla)
}

/**
 * Classifica uma fonte pelo código, na 1ª regra cujo prefixo casa (ordem da
 * composição). Sem regra → NAO_CLASSIFICADA (honesto: inclui a 9999 da despesa
 * não discriminada e a cauda de fontes ainda não mapeadas).
 */
export function classificarFonte(codigo: string, comp: ClassificacaoFonte): Finalidade {
  for (const r of comp.regras) {
    if (r.prefixos.some((px) => codigo.startsWith(px))) return r.finalidade
  }
  return 'NAO_CLASSIFICADA'
}
