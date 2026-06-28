/**
 * CONFERÊNCIA (read-only) dos MEUS serviços × a captura do portal, mês a mês.
 *
 * Lê os JSONs capturados (scripts/dados/{receita,despesa}-mensal-maringa-<ano>.json)
 * e compara, por mês, com o que os serviços do Gênesis produzem do BANCO:
 *   - receita arrecadada: ArrecadacaoDiariaService.serie(...).arrecadadoTotal
 *   - despesa empenhada:  DespesaDiariaService.serie(...).empenhadoTotal
 *
 * Enquanto a outra sessão não persistir os mensais, o Gênesis vem 0 e a coluna
 * "dif" mostra o quanto falta — quando persistirem, dif → 0 valida os serviços.
 * NÃO grava nada (só lê o banco e os JSONs).
 *
 * Uso: npx tsx scripts/conferir_mensais_portal.ts [--ano 2026]
 */
import 'dotenv/config'
import { readFileSync, existsSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { ArrecadacaoDiariaService } from '../src/services/arrecadacao-diaria.js'
import { DespesaDiariaService } from '../src/services/despesa-diaria.js'

const ENT_NOME = 'Prefeitura do Município'

function argNum(flag: string, def: number): number {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) {
    const n = parseInt(process.argv[i + 1] as string, 10)
    if (Number.isFinite(n)) return n
  }
  return def
}

interface Captura {
  meses: { mes: number; linhas: { folha: boolean; arrecadado?: number; empenhado?: number }[] }[]
}
const somaFolhas = (cap: Captura | null, mes: number, campo: 'arrecadado' | 'empenhado'): number =>
  (cap?.meses.find((m) => m.mes === mes)?.linhas ?? []).filter((l) => l.folha).reduce((a, l) => a + (Number(l[campo]) || 0), 0)

const ler = (p: string): Captura | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Captura) : null)
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const fim = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0))
const ini = (ano: number, mes: number) => new Date(Date.UTC(ano, mes - 1, 1))

async function main() {
  const ano = argNum('--ano', new Date().getFullYear())
  const rec = ler(`scripts/dados/receita-mensal-maringa-${ano}.json`)
  const des = ler(`scripts/dados/despesa-mensal-maringa-${ano}.json`)
  if (!rec && !des) {
    console.error('Nenhuma captura encontrada em scripts/dados/. Rode os capturadores primeiro.')
    process.exitCode = 1
    return
  }

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    const ent = await prisma.entidade.findFirst({ where: { nome: ENT_NOME }, select: { id: true } })
    if (!ent) throw new Error(`Entidade "${ENT_NOME}" não encontrada.`)
    const arrSvc = new ArrecadacaoDiariaService(prisma)
    const despSvc = new DespesaDiariaService(prisma)
    const meses = [...new Set([...(rec?.meses ?? []), ...(des?.meses ?? [])].map((m) => m.mes))].sort((a, b) => a - b)

    console.log(`Conferência ${ano} — portal × Gênesis (R$)\n`)
    console.log('mês | RECEITA portal | Gênesis | dif      || DESPESA(emp) portal | Gênesis | dif')
    for (const mes of meses) {
      const filtro = { de: ini(ano, mes), ate: fim(ano, mes) }
      const gArr = rec ? (await arrSvc.serie(ent.id, ano, filtro)).arrecadadoTotal.toNumber() : 0
      const gEmp = des ? (await despSvc.serie(ent.id, ano, filtro)).empenhadoTotal.toNumber() : 0
      const pArr = somaFolhas(rec, mes, 'arrecadado')
      const pEmp = somaFolhas(des, mes, 'empenhado')
      console.log(
        `${String(mes).padStart(2, '0')} | ${brl(pArr).padStart(16)} | ${brl(gArr).padStart(16)} | ${brl(pArr - gArr).padStart(14)} || ${brl(pEmp).padStart(16)} | ${brl(gEmp).padStart(16)} | ${brl(pEmp - gEmp).padStart(14)}`,
      )
    }
    console.log('\n(dif = portal − Gênesis; 0 = serviço confere com o portal naquele mês)')
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error('Falha na conferência:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
