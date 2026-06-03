/**
 * Importa o Catálogo de Materiais (CATMAT) 2026 no ItemCatalogo (tipo=MATERIAL,
 * unidadeMedida='UN'). CSV gerado por scripts/xlsx_catmat_para_csv.py.
 *
 * Idempotente: createMany com skipDuplicates sobre @@unique([tipo, codigo]) —
 * reexecutar só insere códigos novos. Inserção em lotes (CATMAT ~163k linhas).
 *
 * Rodar: npx tsx scripts/importar_catmat_2026.ts [<caminho.csv>]
 * (default: data/catmat_2026.csv)
 */

import { readFileSync } from 'node:fs'
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { parseCSVLine } from '../src/services/importador-plano-contas.js'

const LOTE = 5000
const UNIDADE = 'UN' // o CATMAT não traz unidade; padrão do projeto

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const arquivo = process.argv[2] ?? 'data/catmat_2026.csv'
console.log(`[1/3] Lendo ${arquivo} ...`)
const texto = readFileSync(arquivo, 'utf-8').replace(/^﻿/, '')
const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '')
const header = parseCSVLine(linhas[0]!).map((c) => c.trim())
const iCod = header.indexOf('codigo')
const iDesc = header.indexOf('descricao')
if (iCod < 0 || iDesc < 0) throw new Error('CSV precisa das colunas "codigo" e "descricao".')

const dados = linhas.slice(1).map((l) => {
  const p = parseCSVLine(l)
  return { tipo: 'MATERIAL' as const, codigo: (p[iCod] ?? '').trim(), descricao: (p[iDesc] ?? '').trim(), unidadeMedida: UNIDADE }
})
console.log(`      ${dados.length} itens no arquivo`)

console.log(`[2/3] Inserindo (lotes de ${LOTE}, skipDuplicates) ...`)
const t0 = Date.now()
let inseridos = 0
for (let i = 0; i < dados.length; i += LOTE) {
  const { count } = await prisma.itemCatalogo.createMany({ data: dados.slice(i, i + LOTE), skipDuplicates: true })
  inseridos += count
}
console.log(`      inseridos=${inseridos}  já existentes(pulados)=${dados.length - inseridos}  em ${Date.now() - t0} ms`)

console.log(`[3/3] Conferindo no banco ...`)
const total = await prisma.itemCatalogo.count({ where: { tipo: 'MATERIAL' } })
console.log(`      itens_catalogo (MATERIAL): ${total}`)

await prisma.$disconnect()
await pool.end()
