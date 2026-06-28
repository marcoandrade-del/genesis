/**
 * CAPTURA (read-only — NÃO grava no banco) da DESPESA EXECUTADA MENSAL da
 * Prefeitura de Maringá no Portal da Transparência (Elotech).
 *
 * Endpoint (mesmo do import da LOA, agora mês a mês):
 *   /despesapornivel/detalhada?dataInicial=YYYY-MM-01&dataFinal=YYYY-MM-DD
 *   headers: entidade: 1, exercicio: ANO
 * Devolve a árvore PROGRAMÁTICA com, para o PERÍODO: valorEmpenhado,
 * valorEmLiquidacao, valorLiquidado, valorPago (e o fixado/atualizado).
 * O `dataInicial/dataFinal` filtra o período (igual à receita — confirmado).
 *
 * Varre mês a mês e escreve um JSON CRU para a outra sessão (valores mensais /
 * LRF / MSC) PERSISTIR. NÃO toca o banco. Divisão: "eu capturo; eles persistem".
 *
 * Uso:
 *   npx tsx scripts/capturar_despesa_mensal_maringa.ts [--ano 2026] [--ate 6] [--saida arquivo.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const BASE = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'
const ENTIDADE = '1'

function argNum(flag: string, def: number): number {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) {
    const n = parseInt(process.argv[i + 1] as string, 10)
    if (Number.isFinite(n)) return n
  }
  return def
}
function argStr(flag: string, def: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : def
}

interface LinhaPortal {
  programatica: string
  descricao: string
  nivel: number
  aceitaMovimentacao: string
  valorEmpenhado: number
  valorEmLiquidacao: number
  valorLiquidado: number
  valorPago: number
  valorCreditosAdicionais: number
}
interface LinhaCrua {
  programatica: string
  descricao: string
  nivel: number
  folha: boolean
  empenhado: number
  emLiquidacao: number
  liquidado: number
  pago: number
  creditosAdicionais: number
}

async function getJson<T>(path: string, headers: Record<string, string>): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', ...headers } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (e) {
      if (tentativa >= 3) throw new Error(`Falha em ${path}: ${e instanceof Error ? e.message : e}`)
      await new Promise((r) => setTimeout(r, 1000 * tentativa))
    }
  }
}

const z2 = (n: number) => String(n).padStart(2, '0')
const ultimoDia = (ano: number, mes: number) => new Date(ano, mes, 0).getDate()
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

async function main() {
  const agora = new Date()
  const ano = argNum('--ano', agora.getFullYear())
  const atePadrao = ano === agora.getFullYear() ? agora.getMonth() + 1 : 12
  const ateMes = Math.min(12, Math.max(1, argNum('--ate', atePadrao)))
  const saida = argStr('--saida', `scripts/dados/despesa-mensal-maringa-${ano}.json`)

  console.log(`Capturando despesa executada de Maringá — exercício ${ano}, meses 1..${ateMes}`)
  const meses: { mes: number; dataInicial: string; dataFinal: string; linhas: LinhaCrua[] }[] = []

  for (let mes = 1; mes <= ateMes; mes++) {
    const dataInicial = `${ano}-${z2(mes)}-01`
    const dataFinal = `${ano}-${z2(mes)}-${z2(ultimoDia(ano, mes))}`
    const bruto = await getJson<LinhaPortal[]>(
      `/despesapornivel/detalhada?dataInicial=${dataInicial}&dataFinal=${dataFinal}`,
      { entidade: ENTIDADE, exercicio: String(ano) },
    )
    const linhas: LinhaCrua[] = bruto.map((l) => ({
      programatica: String(l.programatica ?? ''),
      descricao: l.descricao,
      nivel: l.nivel,
      folha: l.aceitaMovimentacao === 'S',
      empenhado: Number(l.valorEmpenhado) || 0,
      emLiquidacao: Number(l.valorEmLiquidacao) || 0,
      liquidado: Number(l.valorLiquidado) || 0,
      pago: Number(l.valorPago) || 0,
      creditosAdicionais: Number(l.valorCreditosAdicionais) || 0,
    }))
    // total do mês = soma das FOLHAS (não dupla-conta os níveis sintéticos)
    const folhas = linhas.filter((l) => l.folha)
    const empMes = folhas.reduce((a, l) => a + l.empenhado, 0)
    console.log(`  ${z2(mes)}/${ano}: ${linhas.length} linhas (${folhas.length} folhas) · empenhado do mês R$ ${brl(empMes)}`)
    meses.push({ mes, dataInicial, dataFinal, linhas })
  }

  const out = {
    fonte: `${BASE}/despesapornivel/detalhada (Portal da Transparência Maringá — Elotech)`,
    entidadePortal: ENTIDADE,
    descricaoEntidade: 'Prefeitura do Município de Maringá',
    exercicio: ano,
    capturadoEm: agora.toISOString(),
    observacao:
      'Captura read-only por programática, mês a mês (dataInicial/dataFinal). empenhado/emLiquidacao/liquidado/pago são do MÊS. nivel 11 + folha=true = dotação analítica. O portal não abre fonte de recurso aqui. Persistência é da outra sessão.',
    meses,
  }
  mkdirSync(dirname(saida), { recursive: true })
  writeFileSync(saida, JSON.stringify(out, null, 2))
  const totalEmp = meses.reduce((a, m) => a + m.linhas.filter((l) => l.folha).reduce((x, l) => x + l.empenhado, 0), 0)
  console.log(`\nArquivo: ${saida}`)
  console.log(`Empenhado (Σ folhas, meses 1..${ateMes}): R$ ${brl(totalEmp)}`)
}

main().catch((e) => {
  console.error('Falha na captura:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
