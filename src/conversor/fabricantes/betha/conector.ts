import type {
  ConectorFabricante,
  MunicipioConfig,
  EntidadeConfig,
  LinhaReceita,
  LinhaDespesa,
} from '../../nucleo/tipos.js'
import { lerConsulta, type LinhaConsulta } from './dados-abertos.js' // legado: só a DESPESA (a migrar)
import { lerConsulta as lerBusca, entidadeDoId } from './api.js' // RECEITA: API real (busca-textual)
import { naturezaReceitaBetha, naturezaDespesaElemento, funcao2, subfuncao3, programa4 } from './codigo.js'

/**
 * Conector do FABRICANTE BETHA (Transparência Cloud). Lê o ORÇAMENTÁRIO pelo
 * motor de DADOS ABERTOS (INDA) — `GET {base}/api/consulta/{consultaId}?formato=json`,
 * SEM token — e devolve linhas já normalizadas em PCASP.
 *
 * Config (em `ent.params`, com o que é do MUNICÍPIO mesclado sob a entidade):
 *   dadosAbertosUrl   → base do dados-abertos (default: cfg.portalUrl)
 *   consultaReceita   → id do dataset "receita orçamentária" do município
 *   consultaDespesa   → id do dataset "despesa orçamentária / QDD" do município
 *
 * ⚠️ VALIDAÇÃO (deixado p/ um município Betha real, ver [[conversor-arquitetura-fabricante]]):
 * os NOMES DAS COLUNAS do dados-abertos variam por município. O resolvedor abaixo
 * tenta os nomes mais comuns (case/acento-insensível) e, se não achar uma coluna
 * OBRIGATÓRIA, FALHA ALTO listando as colunas disponíveis — assim o primeiro run
 * contra um ente real revela o layout exato em vez de gerar dado silenciosamente
 * errado. O que muda por município é o nome da coluna aqui; a estrutura (natureza
 * PCASP, dimensões) é nacional.
 */

const norm = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

/** Valor monetário do dados-abertos → centavos. Aceita número (reais) ou string
 * ("1.234.567,89" ou "1234567.89"). */
function centavos(v: unknown): number {
  if (typeof v === 'number') return Math.round(v * 100)
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return 0
    const brasileiro = /,\d{1,2}$/.test(s)
    const limpo = brasileiro ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
    return Math.round((parseFloat(limpo) || 0) * 100)
  }
  return 0
}

/**
 * Leitor de colunas de um dataset: indexa as chaves da 1ª linha (todas as linhas
 * compartilham o schema) e resolve por candidatos normalizados. `req` falha alto.
 */
function leitor(linhas: LinhaConsulta[], contexto: string) {
  const idx = new Map<string, string>() // chave normalizada → chave original
  for (const k of Object.keys(linhas[0] ?? {})) idx.set(norm(k), k)
  const achar = (candidatos: string[]): string | undefined => {
    for (const c of candidatos) {
      const k = idx.get(norm(c))
      if (k !== undefined) return k
    }
    return undefined
  }
  return {
    /** valor cru da 1ª coluna presente (para valores monetários opcionais). */
    raw: (row: LinhaConsulta, candidatos: string[]): unknown => {
      const k = achar(candidatos)
      return k === undefined ? undefined : row[k]
    },
    /** coluna de texto opcional: '' quando ausente. */
    opt: (row: LinhaConsulta, candidatos: string[]): string => {
      const k = achar(candidatos)
      return k === undefined ? '' : String(row[k] ?? '')
    },
    /** coluna de texto obrigatória: FALHA ALTO listando as colunas disponíveis. */
    req: (row: LinhaConsulta, candidatos: string[]): string => {
      const k = achar(candidatos)
      if (k === undefined) {
        throw new Error(
          `Betha dados-abertos (${contexto}): nenhuma coluna casou ${JSON.stringify(candidatos)}. ` +
            `Colunas disponíveis: ${Object.keys(linhas[0] ?? {}).join(', ') || '(vazio)'}. ` +
            `Ajuste os candidatos em fabricantes/betha/conector.ts para este município.`,
        )
      }
      return String(row[k] ?? '')
    },
  }
}

const FONTE_PLACEHOLDER = { codigo: '9999', descricao: 'Fonte não discriminada (dados-abertos Betha)' }

const baseDe = (cfg: MunicipioConfig, ent: EntidadeConfig): string | undefined =>
  ent.params?.dadosAbertosUrl ?? cfg.portalUrl

const COL_FONTE = ['fonteRecurso', 'codigoFonteRecurso', 'fonte', 'codigoFonte', 'recurso']
const COL_FONTE_DESC = ['descricaoFonteRecurso', 'nomeFonteRecurso', 'descricaoFonte', 'fonteRecursoDescricao']

export const conectorBetha: ConectorFabricante = {
  nome: 'Betha (Transparência Cloud)',

  /**
   * RECEITA via API REAL do Betha (busca-textual): token anônimo + header
   * `app-context` + `POST /api/busca-textual/{consultaReceita}` filtrado por ano.
   * Agrega por ENTIDADE×natureza somando os meses (previsão = Σ orçado,
   * arrecadado = Σ arrecadado no mês) — é como o portal totaliza. Validado AO
   * CENTAVO em Criciúma 2026 (orçado 2.127.975.634,05 · arrecadado
   * 708.247.979,27, Δ 0). A consulta
   * "Receitas Orçamentárias" do Betha NÃO traz fonte → fonte = placeholder.
   *
   * `ent.params`: `portalHash` (hash do portal na URL do município),
   * `consultaReceita` (id do dataset) e, opcional, `entidadeBetha` (código p/
   * filtrar a entidade; ausente = todas as entidades do portal).
   */
  async lerReceita(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaReceita[]> {
    const portalHash = ent.params?.portalHash
    const consulta = ent.params?.consultaReceita
    if (!portalHash || !consulta) return []
    const entidadeBetha = ent.params?.entidadeBetha
    const todas = await lerBusca({ consultaId: consulta, portalHash, filtros: { ano: [String(cfg.ano)] } })
    const linhas = entidadeBetha ? todas.filter((l) => entidadeDoId(l.id) === entidadeBetha) : todas
    if (!linhas.length) return []

    const L = leitor(
      linhas.map((l) => l.campos),
      'receita',
    )
    // Agrega por ENTIDADE×natureza. Cada linha do busca-textual é um mês da
    // natureza; tanto o orçado quanto o arrecadado são somados sobre os meses —
    // é assim que o próprio portal totaliza (os totalizadores de "Receitas
    // Orçamentárias" e de "Receita Prevista x Realizada" batem com a Σ; validado
    // AO CENTAVO em Criciúma 2026: orçado 2.127.975.634,05 · arrecadado
    // 708.247.979,27).
    const grupos = new Map<string, { natureza: string; previsto: number; arrecadado: number }>()
    for (const l of linhas) {
      const natureza = L.req(l.campos, ['rubricaNatureza', 'naturezaReceita', 'codigoReceita', 'codigoNaturezaReceita', 'receita', 'codigo'])
      const chave = `${entidadeDoId(l.id)}|${natureza}`
      const g = grupos.get(chave) ?? { natureza, previsto: 0, arrecadado: 0 }
      g.previsto += centavos(L.raw(l.campos, ['valorOrcadoAtualizado', 'valorOrcado', 'previsto', 'orcado', 'valorPrevisto']))
      g.arrecadado += centavos(L.raw(l.campos, ['valorArrecadadoNoMes', 'arrecadadoNoMes', 'valorArrecadado', 'arrecadado']))
      grupos.set(chave, g)
    }

    const out: LinhaReceita[] = []
    for (const g of grupos.values()) {
      if (g.previsto === 0 && g.arrecadado === 0) continue
      out.push({
        naturezaPcasp: naturezaReceitaBetha(g.natureza),
        fonte: { ...FONTE_PLACEHOLDER },
        ...(g.previsto ? { previsto: g.previsto } : {}),
        ...(g.arrecadado ? { arrecadado: g.arrecadado } : {}),
      })
    }
    return out
  },

  async lerDespesa(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaDespesa[]> {
    const url = baseDe(cfg, ent)
    const consulta = ent.params?.consultaDespesa
    if (!url || !consulta) return []
    const linhas = await lerConsulta(url, consulta)
    if (!linhas.length) return []

    const L = leitor(linhas, 'despesa')
    const out: LinhaDespesa[] = []
    for (const row of linhas) {
      const valor = centavos(L.raw(row, ['valorFixado', 'fixado', 'valorDotacaoInicial', 'dotacaoInicial', 'valorOrcado', 'valorAtualizado', 'valorDotacao', 'dotacao', 'valorPrevisto']))
      if (valor <= 0) continue
      const fonteCod = L.opt(row, COL_FONTE)
      const fonteDesc = L.opt(row, COL_FONTE_DESC)
      const programaNome = L.opt(row, ['nomePrograma', 'descricaoPrograma'])
      const acaoNome = L.opt(row, ['nomeAcao', 'descricaoAcao'])
      out.push({
        orgao: { codigo: L.req(row, ['codigoOrgao', 'orgao', 'codOrgao']), nome: L.opt(row, ['nomeOrgao', 'descricaoOrgao', 'orgaoNome']) },
        unidade: { codigo: L.req(row, ['codigoUnidade', 'unidade', 'codUnidade', 'unidadeOrcamentaria']), nome: L.opt(row, ['nomeUnidade', 'descricaoUnidade', 'unidadeNome']) },
        funcao: funcao2(L.req(row, ['funcao', 'codigoFuncao', 'codFuncao'])),
        subfuncao: subfuncao3(L.req(row, ['subfuncao', 'subFuncao', 'codigoSubfuncao', 'codigoSubFuncao'])),
        programa: { codigo: programa4(L.req(row, ['programa', 'codigoPrograma', 'codPrograma'])), ...(programaNome ? { nome: programaNome } : {}) },
        acao: { codigo: L.req(row, ['acao', 'codigoAcao', 'projetoAtividade', 'codAcao']), ...(acaoNome ? { nome: acaoNome } : {}) },
        naturezaPcasp: naturezaDespesaElemento(L.req(row, ['naturezaDespesa', 'codigoNaturezaDespesa', 'naturezaOrcamentaria', 'elementoDespesa', 'despesa'])),
        fonte: fonteCod ? { codigo: fonteCod, descricao: fonteDesc || fonteCod } : { ...FONTE_PLACEHOLDER },
        autorizado: valor,
      })
    }
    return out
  },
}
