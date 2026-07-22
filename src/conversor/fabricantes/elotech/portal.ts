import type { LinhaReceita, LinhaDespesa } from '../../nucleo/tipos.js'
import { naturezaReceita, parseProgramatica } from './codigo.js'

/**
 * Cliente do Portal da Transparência ELOTECH (produto OXY). Lê o ORÇAMENTÁRIO
 * (previsão da receita + arrecadação + dotação da despesa) de uma entidade via
 * API aberta e devolve linhas já NORMALIZADAS em PCASP.
 *
 * `baseUrl` = base da API (ex. https://transparencia.<mun>.pr.gov.br/portaltransparencia-api).
 * `idPortal` = id da entidade no portal (1=Prefeitura, e um id por autarquia/câmara).
 */
const cent = (n: number): number => Math.round((n ?? 0) * 100)

async function getJson<T>(baseUrl: string, path: string, headers: Record<string, string> = {}): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const res = await fetch(`${baseUrl}${path}`, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`)
      return (await res.json()) as T
    } catch (e) {
      if (tentativa >= 3) throw e
      await new Promise((r) => setTimeout(r, 1000 * tentativa))
    }
  }
}

/** map com concorrência limitada, preservando a ordem (dezenas de fontes = 1 fetch cada). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++
      out[idx] = await fn(items[idx]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

type PortalFonte = { receita: string; descricao: string; valorOrcado: number | null; valorArrecadado: number | null }
type PortalReceitaDetalhe = { receita: string; valorOrcado: number | null; valorArrecadado: number | null }
type PortalDespesa = {
  programatica: string
  descricao: string
  nivel: number
  aceitaMovimentacao: string // 'S' na folha (dotação), 'N' nos níveis intermediários
  valorPrevisto: number // dotação INICIAL (LOA)
  valorEmpenhado: number
  valorLiquidado: number
  valorPago: number
}

/**
 * Previsão da receita (LOA) + arrecadação por natureza×fonte. Itera as fontes
 * com valor e busca o detalhe de cada uma; agrega por (natureza, fonte) — o
 * portal pode repetir a mesma chave, então SOMA (não sobrescreve).
 */
export async function lerReceita(baseUrl: string, ano: number, idPortal: string): Promise<LinhaReceita[]> {
  const q = `entidade=${idPortal}&exercicio=${ano}`
  const fontes = await getJson<PortalFonte[]>(baseUrl, `/api/receitas/fonte-recursos?${q}`)
  // Inclui fontes SÓ com arrecadação (orçado 0): autarquias/fundos têm receita
  // própria não-orçada (ex. taxas, remuneração) — o filtro só-orçado a perdia.
  const comValor = fontes.filter((f) => (f.valorOrcado ?? 0) !== 0 || (f.valorArrecadado ?? 0) !== 0)

  // uma fonte = um fetch de detalhe; são dezenas → busca em paralelo (limitado).
  const detalhes = await mapLimit(comValor, 8, async (fonte) => ({
    fonte,
    rows: await getJson<PortalReceitaDetalhe[]>(baseUrl, `/api/receitas/fonte-recursos/detalhes?${q}&fonteRecurso=${fonte.receita}`),
  }))

  const agg = new Map<string, LinhaReceita>()
  for (const { fonte, rows } of detalhes) {
    for (const r of rows) {
      const previsto = r.valorOrcado ?? 0
      const arrecadado = r.valorArrecadado ?? 0
      if (previsto === 0 && arrecadado === 0) continue
      const natureza = naturezaReceita(r.receita)
      const chave = `${natureza}|${fonte.receita}`
      const alvo = agg.get(chave)
      if (alvo) {
        alvo.previsto = (alvo.previsto ?? 0) + cent(previsto)
        alvo.arrecadado = (alvo.arrecadado ?? 0) + cent(arrecadado)
      } else {
        agg.set(chave, {
          naturezaPcasp: natureza,
          fonte: { codigo: String(fonte.receita), descricao: fonte.descricao },
          previsto: cent(previsto),
          arrecadado: cent(arrecadado),
        })
      }
    }
  }
  return [...agg.values()]
}

/**
 * Dotação (orçado) + execução (empenhado/liq/pago) da despesa. Busca a árvore
 * programática do exercício, usa os níveis intermediários para os NOMES das
 * dimensões e as FOLHAS (`aceitaMovimentacao==='S'`) como dotações. A execução vem
 * do PRÓPRIO portal (mesmas linhas), então o Elotech é autossuficiente — não
 * precisa de TCE/SICONFI (`tce:'portal'`). O portal NÃO publica fonte por dotação
 * → tudo cai na fonte "9999" (a fonte real por dotação só viria do TCE/PIT).
 */
export async function lerDespesa(baseUrl: string, ano: number, idPortal: string): Promise<LinhaDespesa[]> {
  const rows = await getJson<PortalDespesa[]>(
    baseUrl,
    `/despesapornivel/detalhada?dataInicial=${ano}-01-01&dataFinal=${ano}-12-31`,
    { entidade: idPortal, exercicio: String(ano) },
  )

  // nomes das dimensões a partir dos níveis intermediários
  const nomeOrgao = new Map<string, string>()
  const nomeUnidade = new Map<string, string>() // "02.010" → nome
  const nomePrograma = new Map<string, string>()
  const nomeAcao = new Map<string, string>() // "0002|2001" → nome
  for (const d of rows) {
    const p = d.programatica.split('.')
    if (d.nivel === 1) nomeOrgao.set(p[0]!, d.descricao)
    else if (d.nivel === 2) nomeUnidade.set(d.programatica, d.descricao)
    else if (d.nivel === 5) nomePrograma.set(p[4]!, d.descricao)
    else if (d.nivel === 6) nomeAcao.set(`${p[4]}|${p[5]}`, d.descricao)
  }

  const linhas: LinhaDespesa[] = []
  for (const d of rows) {
    // Folha (dotação) = `aceitaMovimentacao==='S'` — NÃO um nível fixo: o Elotech
    // novo (3.111) fecha no nível 11, o antigo (3.100) no 10. Inclui a linha se há
    // dotação inicial OU execução (empenho de crédito adicional cai aqui também).
    if (d.aceitaMovimentacao !== 'S') continue
    if ((d.valorPrevisto ?? 0) <= 0 && (d.valorEmpenhado ?? 0) <= 0) continue
    const c = parseProgramatica(d.programatica)
    if (!c) continue // programática fora do padrão pontuado (ex. Elotech antigo) — ignora
    linhas.push({
      orgao: { codigo: c.orgao, nome: nomeOrgao.get(c.orgao) ?? `Órgão ${c.orgao}` },
      unidade: { codigo: c.unidade, nome: nomeUnidade.get(`${c.orgao}.${c.unidade}`) ?? `Unidade ${c.orgao}.${c.unidade}` },
      funcao: c.funcao,
      subfuncao: c.subfuncao,
      programa: { codigo: c.programa, ...(nomePrograma.get(c.programa) ? { nome: nomePrograma.get(c.programa) } : {}) },
      acao: { codigo: c.acao, ...(nomeAcao.get(`${c.programa}|${c.acao}`) ? { nome: nomeAcao.get(`${c.programa}|${c.acao}`) } : {}) },
      naturezaPcasp: c.naturezaPcasp,
      // O portal NÃO publica a fonte por dotação → tudo cai em "9999". A fonte real
      // por dotação só viria do TCE (PIT); aqui priorizamos 100% portal.
      fonte: { codigo: '9999', descricao: 'Fonte não discriminada (portal Elotech)' },
      autorizado: cent(d.valorPrevisto),
      // Execução do PRÓPRIO portal (mesmas linhas da LOA) — dispensa TCE/SICONFI.
      empenhado: cent(d.valorEmpenhado),
      liquidado: cent(d.valorLiquidado),
      pago: cent(d.valorPago),
    })
  }
  return linhas
}
