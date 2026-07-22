/**
 * Runner turn-key do conversor ELOTECH (portal da transparência / OXY). "Ligar o
 * carro": escolhe o município pela sigla e importa receita + despesa 100% do
 * portal do fabricante (execução embutida, sem PIT/SICONFI).
 *
 *   npx tsx scripts/importar_elotech.ts <cianorte|navirai|vilhena|sarandi|todos> [--apply]
 *
 * DRY-RUN (default): só LÊ do portal e imprime as magnitudes por entidade (nada
 * escreve). --apply: onboarda + grava via `importarMunicipio`.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { MunicipioConfig } from '../src/conversor/nucleo/tipos.js'
import { importarMunicipio } from '../src/conversor/importar.js'
import { conectorElotech } from '../src/conversor/fabricantes/elotech/conector.js'
import { cianortePr } from '../src/conversor/municipios/cianorte-pr.js'
import { naviraiMs } from '../src/conversor/municipios/navirai-ms.js'
import { vilhenaRo } from '../src/conversor/municipios/vilhena-ro.js'
import { sarandiPr } from '../src/conversor/municipios/sarandi-pr.js'

const CONFIGS: Record<string, MunicipioConfig> = {
  cianorte: cianortePr,
  navirai: naviraiMs,
  vilhena: vilhenaRo,
  sarandi: sarandiPr,
}

const APPLY = process.argv.includes('--apply')
const alvo = (process.argv[2] ?? '').toLowerCase()
const escolhidos = alvo === 'todos' ? Object.values(CONFIGS) : CONFIGS[alvo] ? [CONFIGS[alvo]!] : []
if (!escolhidos.length) {
  console.error(`Uso: npx tsx scripts/importar_elotech.ts <${Object.keys(CONFIGS).join('|')}|todos> [--apply]`)
  process.exit(1)
}

const reais = (cent: number) => (cent / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const soma = (arr: number[]) => arr.reduce((s, n) => s + n, 0)

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

for (const cfg of escolhidos) {
  console.log(`\n═══ ${cfg.nome}/${cfg.uf} ${cfg.ano} — Elotech · ${APPLY ? 'APPLY' : 'DRY-RUN'} ═══`)
  if (!APPLY) {
    // prova a seco: lê do portal e soma, sem tocar o banco
    for (const ent of cfg.entidades) {
      const rec = await conectorElotech.lerReceita(cfg, ent)
      const des = await conectorElotech.lerDespesa(cfg, ent)
      const prev = soma(rec.map((r) => r.previsto ?? 0))
      const arr = soma(rec.map((r) => r.arrecadado ?? 0))
      const aut = soma(des.map((d) => d.autorizado ?? 0))
      const emp = soma(des.map((d) => d.empenhado ?? 0))
      console.log(
        `  ${ent.nome}\n` +
          `    receita: ${rec.length} linhas · previsto ${reais(prev)} · arrecadado ${reais(arr)}\n` +
          `    despesa: ${des.length} dotações · autorizado ${reais(aut)} · empenhado ${reais(emp)}`,
      )
    }
  } else {
    await importarMunicipio(prisma, cfg, (m) => console.log(m))
  }
}

await prisma.$disconnect()
await pool.end()
console.log(APPLY ? '\n✅ import concluído' : '\nDRY-RUN: nada gravado. Rode com --apply.')
