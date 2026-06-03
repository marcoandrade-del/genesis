/**
 * Importa os planos ORÇAMENTÁRIOS do TCE-PR 2026 (Receita e Despesa) nos
 * PlanoContasReceita/PlanoContasDespesa do ModeloContabil "PARANÁ", ano 2026.
 *
 * Os planos já existiam com 4 contas-fixture de teste cada; este script as
 * ESVAZIA (deleteMany por planoId — FK-safe, só auto-hierarquia) antes de
 * importar o oficial. CSVs gerados por scripts/xlsx_tcepr_orcamentario_para_csv.py.
 *
 * Rodar: npx tsx scripts/importar_orcamentario_2026.ts
 */

import { readFileSync } from 'node:fs'
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { parseCSV, validar } from '../src/services/importador-plano-contas.js'
import { ImportadorPlanoReceitaService } from '../src/services/importador-plano-receita.js'
import { ImportadorPlanoDespesaService } from '../src/services/importador-plano-despesa.js'
import { NIVEL_MAX_RECEITA } from '../src/services/contas-receita.js'
import { NIVEL_MAX_DESPESA } from '../src/services/contas-despesa.js'

const MODELO = 'PARANÁ'
const ANO = 2026

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const modelo = await prisma.modeloContabil.findUnique({ where: { descricao: MODELO } })
if (!modelo) throw new Error(`ModeloContabil "${MODELO}" não encontrado.`)

function distNiveis(niveis: Map<string, number>): string {
  const d: Record<number, number> = {}
  for (const n of niveis.values()) d[n] = (d[n] ?? 0) + 1
  return Object.keys(d).sort((a, b) => +a - +b).map((k) => `${k}=${d[+k]}`).join(' ')
}

// ── RECEITA ──────────────────────────────────────────────────────────────────
{
  const csv = readFileSync('data/pcasp_receita_2026.csv', 'utf-8')
  const niveis = validar(parseCSV(csv), NIVEL_MAX_RECEITA)
  console.log(`[RECEITA] CSV: ${niveis.size} contas; níveis: ${distNiveis(niveis)}`)
  const plano = await prisma.planoContasReceita.findUnique({
    where: { modeloContabilId_ano: { modeloContabilId: modelo.id, ano: ANO } },
  })
  if (!plano) throw new Error('PlanoContasReceita PARANÁ/2026 não encontrado.')
  const apagadas = await prisma.contaReceita.deleteMany({ where: { planoId: plano.id } })
  console.log(`[RECEITA] esvaziado: ${apagadas.count} fixture(s) removida(s)`)
  const { criadas } = await new ImportadorPlanoReceitaService(prisma).importar(plano.id, csv)
  const folhas = await prisma.contaReceita.count({ where: { planoId: plano.id, admiteMovimento: true } })
  console.log(`[RECEITA] importadas: ${criadas}  folhas(analíticas)=${folhas}\n`)
}

// ── DESPESA ──────────────────────────────────────────────────────────────────
{
  const csv = readFileSync('data/pcasp_despesa_2026.csv', 'utf-8')
  const niveis = validar(parseCSV(csv), NIVEL_MAX_DESPESA)
  console.log(`[DESPESA] CSV: ${niveis.size} contas; níveis: ${distNiveis(niveis)}`)
  const plano = await prisma.planoContasDespesa.findUnique({
    where: { modeloContabilId_ano: { modeloContabilId: modelo.id, ano: ANO } },
  })
  if (!plano) throw new Error('PlanoContasDespesa PARANÁ/2026 não encontrado.')
  const apagadas = await prisma.contaDespesa.deleteMany({ where: { planoId: plano.id } })
  console.log(`[DESPESA] esvaziado: ${apagadas.count} fixture(s) removida(s)`)
  const { criadas } = await new ImportadorPlanoDespesaService(prisma).importar(plano.id, csv)
  const folhas = await prisma.contaDespesa.count({ where: { planoId: plano.id, admiteMovimento: true } })
  console.log(`[DESPESA] importadas: ${criadas}  folhas(analíticas)=${folhas}`)
}

await prisma.$disconnect()
await pool.end()
