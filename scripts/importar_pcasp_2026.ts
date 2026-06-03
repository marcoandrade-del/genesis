/**
 * Importa o PCASP Estendido TCE-PR 2026 (CSV gerado por
 * scripts/xlsx_tcepr_para_csv.py) no PlanoDeContas já existente
 * "PCASP Estendido 2026" do ModeloContabil "PARANÁ".
 *
 * Plano estendido do TCE-PR chega ao nível 9, dentro do teto NIVEL_MAX (9).
 * Guarda: só importa se o plano estiver vazio, para não colidir com o
 * @@unique([planoId, codigo]).
 *
 * Rodar: npx tsx scripts/importar_pcasp_2026.ts [caminho.csv]
 * (default: data/pcasp_estendido_2026.csv)
 */

import { readFileSync } from 'node:fs'
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { parseCSV, validar, ImportadorPlanoContasService } from '../src/services/importador-plano-contas.js'

const MODELO = 'PARANÁ'
const ANO = 2026

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const arquivo = process.argv[2] ?? 'data/pcasp_estendido_2026.csv'
console.log(`[1/4] Lendo + validando ${arquivo} ...`)
const csv = readFileSync(arquivo, 'utf-8')
const linhas = parseCSV(csv)
const niveis = validar(linhas)
const dist: Record<number, number> = {}
for (const n of niveis.values()) dist[n] = (dist[n] ?? 0) + 1
console.log(`      ${linhas.length} contas; níveis: ${Object.keys(dist).sort((a, b) => +a - +b).map((k) => `${k}=${dist[+k]}`).join(' ')}`)

console.log(`[2/4] Localizando plano "${MODELO}" / ${ANO} ...`)
const modelo = await prisma.modeloContabil.findUnique({ where: { descricao: MODELO } })
if (!modelo) throw new Error(`ModeloContabil "${MODELO}" não encontrado.`)
const plano = await prisma.planoDeContas.findUnique({
  where: { modeloContabilId_ano: { modeloContabilId: modelo.id, ano: ANO } },
})
if (!plano) throw new Error(`PlanoDeContas ${MODELO}/${ANO} não encontrado.`)
const jaExistentes = await prisma.conta.count({ where: { planoId: plano.id } })
console.log(`      plano=${plano.id} "${plano.descricao}" contas atuais=${jaExistentes}`)
if (jaExistentes > 0) {
  throw new Error(`Plano já tem ${jaExistentes} contas. Esvazie-o antes de reimportar (importação é só para plano vazio).`)
}

console.log(`[3/4] Importando ...`)
const t0 = Date.now()
const { criadas } = await new ImportadorPlanoContasService(prisma).importar(plano.id, csv)
console.log(`      ${criadas} contas em ${Date.now() - t0} ms`)

console.log(`[4/4] Conferindo no banco ...`)
const total = await prisma.conta.count({ where: { planoId: plano.id } })
const folhas = await prisma.conta.count({ where: { planoId: plano.id, admiteMovimento: true } })
const porNivel = await prisma.conta.groupBy({
  by: ['nivel'],
  where: { planoId: plano.id },
  _count: { _all: true },
  orderBy: { nivel: 'asc' },
})
console.log(`      total=${total}  folhas(admiteMovimento)=${folhas}`)
for (const g of porNivel) console.log(`      nível ${g.nivel}: ${g._count._all}`)

await prisma.$disconnect()
await pool.end()
