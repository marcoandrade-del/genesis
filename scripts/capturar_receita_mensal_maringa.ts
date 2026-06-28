/**
 * CAPTURA (read-only — NÃO grava no banco) da RECEITA ARRECADADA MENSAL da
 * Prefeitura de Maringá no Portal da Transparência (Elotech).
 *
 * Endpoint (descoberto a partir do dashboard do portal):
 *   /api/receitas/detalhada?entidade=1&exercicio=ANO&dataInicial=YYYY-MM-01&dataFinal=YYYY-MM-DD
 * devolve a ÁRVORE de receita por natureza com, para o PERÍODO informado:
 *   valorArrecadado, valorDeducao, valorRealizadoLiquido (e o orçado do ano).
 * Confirmado que `dataInicial/dataFinal` filtram o período (≠ do acumulado).
 *
 * Varre mês a mês e escreve um JSON CRU para a outra sessão (a dos valores
 * mensais / LRF / MSC) PERSISTIR. ESTE script não toca o banco — só lê o portal
 * e grava um arquivo. Divisão combinada: "eu capturo; eles persistem".
 *
 * Uso:
 *   npx tsx scripts/capturar_receita_mensal_maringa.ts [--ano 2026] [--ate 6] [--saida arquivo.json]
 *   (sem --ate: vai até o mês corrente se for o ano atual; senão dezembro)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const BASE = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'
const ENTIDADE = '1' // Prefeitura do Município de Maringá no portal

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
  receita: string
  descricao: string
  nivel: number
  aceitaMovimentacao: string
  valorArrecadado: number
  valorDeducao: number
  valorRealizadoLiquido: number
  valorOrcado: number
}
interface LinhaCrua {
  codigo: string
  descricao: string
  nivel: number
  folha: boolean
  arrecadado: number
  deducao: number
  realizadoLiquido: number
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Portal respondeu ${res.status} em ${path}`)
  return (await res.json()) as T
}

const z2 = (n: number) => String(n).padStart(2, '0')
const ultimoDia = (ano: number, mes: number) => new Date(ano, mes, 0).getDate()

async function main() {
  const agora = new Date()
  const ano = argNum('--ano', agora.getFullYear())
  const atePadrao = ano === agora.getFullYear() ? agora.getMonth() + 1 : 12
  const ateMes = Math.min(12, Math.max(1, argNum('--ate', atePadrao)))
  const saida = argStr('--saida', `scripts/dados/receita-mensal-maringa-${ano}.json`)

  console.log(`Capturando receita arrecadada de Maringá — exercício ${ano}, meses 1..${ateMes}`)
  const meses: { mes: number; dataInicial: string; dataFinal: string; linhas: LinhaCrua[] }[] = []

  for (let mes = 1; mes <= ateMes; mes++) {
    const dataInicial = `${ano}-${z2(mes)}-01`
    const dataFinal = `${ano}-${z2(mes)}-${z2(ultimoDia(ano, mes))}`
    const bruto = await getJson<LinhaPortal[]>(
      `/api/receitas/detalhada?entidade=${ENTIDADE}&exercicio=${ano}&dataInicial=${dataInicial}&dataFinal=${dataFinal}`,
    )
    const linhas: LinhaCrua[] = bruto.map((l) => ({
      codigo: String(l.receita),
      descricao: l.descricao,
      nivel: l.nivel,
      folha: l.aceitaMovimentacao === 'S',
      arrecadado: Number(l.valorArrecadado) || 0,
      deducao: Number(l.valorDeducao) || 0,
      realizadoLiquido: Number(l.valorRealizadoLiquido) || 0,
    }))
    const totalMes = linhas.find((l) => l.codigo === '1')?.arrecadado ?? 0
    console.log(`  ${z2(mes)}/${ano}: ${linhas.length} naturezas · correntes arrecadado R$ ${totalMes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
    meses.push({ mes, dataInicial, dataFinal, linhas })
  }

  const out = {
    fonte: `${BASE}/api/receitas/detalhada (Portal da Transparência Maringá — Elotech)`,
    entidadePortal: ENTIDADE,
    descricaoEntidade: 'Prefeitura do Município de Maringá',
    exercicio: ano,
    capturadoEm: agora.toISOString(),
    observacao:
      'Captura read-only por natureza, mês a mês (dataInicial/dataFinal). valorArrecadado/deducao/realizadoLiquido são do MÊS. O portal não abre arrecadação por fonte aqui. Persistência é da outra sessão.',
    meses,
  }
  mkdirSync(dirname(saida), { recursive: true })
  writeFileSync(saida, JSON.stringify(out, null, 2))
  const totalGeral = meses.reduce((a, m) => a + (m.linhas.find((l) => l.codigo === '1')?.arrecadado ?? 0), 0)
  console.log(`\nArquivo: ${saida}`)
  console.log(`Receitas correntes arrecadadas (Σ meses 1..${ateMes}): R$ ${totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
}

main().catch((e) => {
  console.error('Falha na captura:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
