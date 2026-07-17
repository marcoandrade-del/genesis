/**
 * Estende o de/para de fonte local→STN para a DESPESA por REGRA MECÂNICA: a fonte
 * é grupo(1díg)+spec; a STN preserva o grupo e converte o spec. Para uma fonte de
 * despesa fora do de/para (ex.: 2004, grupo 2 = exercícios anteriores), busca o
 * canônico grupo-1 ('1'+resto = 1004) no de/para, pega o spec STN (501) e re-
 * prepende o grupo → 2501. Só adota se o STN derivado EXISTE na MSC oficial
 * (validação necessária). Grava no artefato depara_fontes_local_stn.json.
 *
 * A cauda (desdobramentos locais sem canônico grupo-1) NÃO é coberta aqui —
 * exige value-matching por fonte (como a cauda da receita). Ver metrica_gabarito_fonte.
 *
 * Uso: npx tsx scripts/estender_depara_despesa_mecanico.ts [--apply]
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
const APPLY = process.argv.includes('--apply')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384'
const PATH = 'data/abertura-2026/depara_fontes_local_stn.json'
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
async function main() {
  const j = JSON.parse(readFileSync(PATH, 'utf-8'))
  const dep = j.depara as Record<string, string>
  const oficiais = new Set<string>()
  for (const cl of [5, 6, 7, 8]) for (const i of (JSON.parse(readFileSync(`data/abertura-2026/msc_siconfi/mscc_2026-05_eb_classe${cl}.json`, 'utf-8')) as { items: { poder_orgao: string; fonte_recursos?: string | null }[] }).items) {
    if (i.poder_orgao === '10131' && i.fonte_recursos) oficiais.add(String(i.fonte_recursos))
  }
  const derivar = (f: string): string | null => {
    const canon = '1' + f.slice(1)
    if (dep[canon]) return f[0] + dep[canon].slice(1)
    if (f.length === 5) { const pai = '1' + f.slice(1, 4); if (dep[pai]) return f[0] + dep[pai].slice(1) }
    return null
  }
  const gap = (await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: E, ano: 2026, fonteStnCodigo: null }, select: { codigo: true } })).map((f) => f.codigo)
  const novos: Record<string, string> = {}
  for (const f of gap) { if (dep[f]) continue; const s = derivar(f); if (s && oficiais.has(s)) novos[f] = s }
  console.log(`gap: ${gap.length} · derivadas c/ STN na oficial: ${Object.keys(novos).length}`)
  console.log('amostra:', Object.entries(novos).slice(0, 12).map(([a, b]) => `${a}→${b}`).join(' '))
  if (!APPLY) { console.log('\nDRY-RUN.'); await prisma.$disconnect(); return }
  Object.assign(dep, novos)
  j._meta.despesa_mecanica = `+${Object.keys(novos).length} fontes de despesa (grupo+spec mecânico, STN validado na oficial), 2026-07-17`
  writeFileSync(PATH, JSON.stringify(j, null, 2))
  console.log(`\nAPLICADO: de/para agora tem ${Object.keys(dep).length} fontes. Rode popular_fonte_stn_entidade.ts --apply.`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
