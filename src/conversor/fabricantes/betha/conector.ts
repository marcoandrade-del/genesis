import type {
  ConectorFabricante,
  MunicipioConfig,
  EntidadeConfig,
  LinhaReceita,
  LinhaDespesa,
} from '../../nucleo/tipos.js'
import { lerConsulta as lerBusca, entidadeDoId } from './api.js' // API real (busca-textual)
import { naturezaReceitaBetha, naturezaDespesaElemento, funcao2, subfuncao3 } from './codigo.js'

/**
 * Conector do FABRICANTE BETHA (Transparência Cloud). Lê o ORÇAMENTÁRIO pela API
 * REAL do portal (busca-textual — ver `api.ts`) e devolve linhas normalizadas em
 * PCASP. Config (em `ent.params`, com o que é do MUNICÍPIO mesclado sob a entidade):
 *   portalHash       → hash do portal na URL do município (contexto p/ a API)
 *   consultaReceita  → id do dataset "Receitas Orçamentárias" (previsão+arrecadação)
 *   consultaDespesa  → id do dataset "Despesas por Classificação" (execução/empenho)
 *   entidadeBetha    → (opc.) código da entidade p/ filtrar; ausente = todas
 *
 * O resolvedor de coluna (`leitor`) tenta os nomes mais comuns (case/acento-
 * insensível) e FALHA ALTO listando as colunas disponíveis se faltar uma
 * obrigatória — assim o 1º run contra um ente real revela o layout exato. A
 * RECEITA está validada ao centavo (Criciúma 2026); a DESPESA está construída com
 * a validação ao centavo dos totais PENDENTE (ES do Betha instável na construção).
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
function leitor(linhas: Record<string, unknown>[], contexto: string) {
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
    raw: (row: Record<string, unknown>, candidatos: string[]): unknown => {
      const k = achar(candidatos)
      return k === undefined ? undefined : row[k]
    },
    /** coluna de texto opcional: '' quando ausente. */
    opt: (row: Record<string, unknown>, candidatos: string[]): string => {
      const k = achar(candidatos)
      return k === undefined ? '' : String(row[k] ?? '')
    },
    /** coluna de texto obrigatória: FALHA ALTO listando as colunas disponíveis. */
    req: (row: Record<string, unknown>, candidatos: string[]): string => {
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

/**
 * As dimensões da despesa no busca-textual do Betha vêm como DESCRIÇÃO combinada
 * "código - nome" (ex. "02 - EXECUTIVO", "04 - Administração", "1500 - Recursos
 * Ordinários"). Extrai o código (dígitos/pontos à frente) e o nome. Sem código à
 * frente → código vazio (o chamador decide se falha ou usa placeholder).
 */
function codigoNome(descricao: string): { codigo: string; nome: string } {
  const m = descricao.match(/^\s*([\d.]+)\s*[-–—]\s*(.*)$/)
  if (m) return { codigo: m[1]!, nome: m[2]!.trim() }
  return { codigo: '', nome: descricao.trim() }
}

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

  /**
   * DESPESA (EXECUÇÃO) via API real do Betha — consulta "Despesas por
   * Classificação Orçamentária" (`consultaDespesa`, ex. 174485). É nível EMPENHO
   * (o Betha, em SC, cobre também a execução — que no modelo do conversor viria do
   * TCE): alimenta empenhado/liquidado/pago da `LinhaDespesa`, NÃO a dotação.
   * Agrega por órgão×unidade×função×subfunção×natureza×fonte, somando os empenhos.
   * A consulta NÃO expõe programa/ação nas linhas → placeholder "0000" (o núcleo
   * cria a dimensão genérica). ⚠️ Validação ao centavo dos totais (empenhado/
   * liquidado/pago) PENDENTE (ES do Betha estava fora na construção) — ver memória
   * `betha-transparencia-api-decifrada`.
   *
   * `ent.params`: `portalHash`, `consultaDespesa`, opc. `entidadeBetha`.
   */
  async lerDespesa(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaDespesa[]> {
    const portalHash = ent.params?.portalHash
    const consulta = ent.params?.consultaDespesa
    if (!portalHash || !consulta) return []
    const entidadeBetha = ent.params?.entidadeBetha
    const todas = await lerBusca({ consultaId: consulta, portalHash, filtros: { ano: [String(cfg.ano)] } })
    const linhas = entidadeBetha ? todas.filter((l) => entidadeDoId(l.id) === entidadeBetha) : todas
    if (!linhas.length) return []

    const L = leitor(
      linhas.map((l) => l.campos),
      'despesa',
    )
    type Grupo = {
      orgao: { codigo: string; nome: string }
      unidade: { codigo: string; nome: string }
      funcao: string
      subfuncao: string
      natureza: string
      fonte: { codigo: string; descricao: string }
      empenhado: number
      liquidado: number
      pago: number
    }
    const grupos = new Map<string, Grupo>()
    for (const l of linhas) {
      const orgao = codigoNome(L.req(l.campos, ['descricaoOrgao', 'orgao', 'nomeOrgao', 'codigoOrgao']))
      const unidade = codigoNome(L.req(l.campos, ['descricaoUnidade', 'unidade', 'nomeUnidade', 'codigoUnidade']))
      const funcao = funcao2(codigoNome(L.req(l.campos, ['descricaoFuncao', 'funcao', 'codigoFuncao'])).codigo)
      const subfuncao = subfuncao3(codigoNome(L.req(l.campos, ['descricaoSubfuncao', 'subfuncao', 'codigoSubfuncao'])).codigo)
      const natureza = naturezaDespesaElemento(L.req(l.campos, ['mascaraElemento', 'descricaoElemento', 'naturezaDespesa', 'elementoDespesa']))
      const recurso = codigoNome(L.opt(l.campos, ['descricaoRecurso', 'fonteRecurso', 'recurso', 'fonte']))
      const fonte = recurso.codigo ? { codigo: recurso.codigo, descricao: recurso.nome || recurso.codigo } : { ...FONTE_PLACEHOLDER }
      const chave = `${entidadeDoId(l.id)}|${orgao.codigo}.${unidade.codigo}|${funcao}|${subfuncao}|${natureza}|${fonte.codigo}`
      const g = grupos.get(chave) ?? { orgao, unidade, funcao, subfuncao, natureza, fonte, empenhado: 0, liquidado: 0, pago: 0 }
      g.empenhado += centavos(L.raw(l.campos, ['valorEmpenho', 'valorEmpenhado', 'empenhado']))
      g.liquidado += centavos(L.raw(l.campos, ['valorLiquidadoEmpenho', 'valorLiquidado', 'liquidado']))
      g.pago += centavos(L.raw(l.campos, ['valorPagoEmpenho', 'valorPago', 'pago']))
      grupos.set(chave, g)
    }

    const out: LinhaDespesa[] = []
    for (const g of grupos.values()) {
      if (!g.empenhado && !g.liquidado && !g.pago) continue
      out.push({
        orgao: g.orgao,
        unidade: g.unidade,
        funcao: g.funcao,
        subfuncao: g.subfuncao,
        programa: { codigo: '0000' }, // 174485 não expõe programa/ação nas linhas
        acao: { codigo: '0000' },
        naturezaPcasp: g.natureza,
        fonte: g.fonte,
        ...(g.empenhado ? { empenhado: g.empenhado } : {}),
        ...(g.liquidado ? { liquidado: g.liquidado } : {}),
        ...(g.pago ? { pago: g.pago } : {}),
      })
    }
    return out
  },
}
