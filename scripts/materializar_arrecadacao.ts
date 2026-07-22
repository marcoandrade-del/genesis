/**
 * Cria linhas `Arrecadacao` AGREGADAS a partir de `PrevisaoReceita.valorArrecadado`
 * — para municípios cuja RECEITA foi importada por scripts standalone (ex.: Paranaguá
 * IPM) que gravaram só o agregado, sem as `Arrecadacao` que o motor E100 precisa para
 * materializar a receita realizada no razão. (O conversor já faz isso no
 * `escreverReceita`; este script é o equivalente para o dado já no banco.)
 *
 * Tipo pela natureza da linha: DEDUCAO (FUNDEB/RENÚNCIA/OUTRAS) quando a conta é
 * redutora ("(-) …"/"dedução"/prefixo 9.7/7); ESTORNO para arrecadado NEGATIVO
 * não-redutora (correção); ARRECADACAO no caso normal. O agregado casa com
 * `valorArrecadado` (líquido) por construção. Idempotente (marcador de histórico).
 *
 *   npx tsx scripts/materializar_arrecadacao.ts <Município> [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma, type ArrecadacaoTipo, type DeducaoTipo } from '@prisma/client'

const ANO = 2026
const HIST = 'CAPTURA ARRECADAÇÃO (conversor)'
const APPLY = process.argv.includes('--apply')
// --sem-prefeitura: pula a Prefeitura (ex.: Maringá, cuja Prefeitura já tem
// Arrecadacao própria #167 — não sobrepor/duplicar).
const SEM_PREFEITURA = process.argv.includes('--sem-prefeitura')
const municipio = process.argv[2]
if (!municipio || municipio.startsWith('--')) {
  console.error('Uso: npx tsx scripts/materializar_arrecadacao.ts <Município> [--apply]')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Decide o tipo pelo SINAL. Arrecadado NEGATIVO = ESTORNO — dá a receita realizada
 * LÍQUIDA (6.2.1.2 = valorArrecadado) ao centavo. NÃO uso DEDUCAO/E150 aqui: quando
 * as linhas ARRECADACAO já são BRUTAS e a dedução (FUNDEB) vem como linha redutora
 * SEPARADA (modelagem do Paranaguá IPM), o E150 ADICIONA a dedução de volta (ele
 * assume ARRECADACAO líquida) → dobra (provado no dry-run: Δ 2× o FUNDEB). O
 * controle DDR do FUNDEB (E150) exige re-modelar a receita p/ líquida+dedução com o
 * FUNDEB atribuído às linhas de origem — follow-up (o −36,8mi vem agregado). `_` só
 * documenta que a decisão é por sinal, não pela conta.
 */
function classificar(_codigo: string, _descricao: string, arrecadado: number): { tipo: ArrecadacaoTipo; deducaoTipo: DeducaoTipo | null } {
  return { tipo: arrecadado < 0 ? 'ESTORNO' : 'ARRECADACAO', deducaoTipo: null }
}

async function main() {
  console.log(`\n═══ Materializar Arrecadacao — ${municipio}/${ANO} ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const ents = await prisma.entidade.findMany({
    where: { municipio: { nome: municipio }, ...(SEM_PREFEITURA ? { tipo: { not: 'PREFEITURA' } } : {}) },
    select: { id: true, nome: true, orcamentos: { where: { ano: ANO }, select: { id: true } } },
    orderBy: { nome: 'asc' },
  })
  if (!ents.length) throw new Error(`Nenhuma entidade no município '${municipio}'`)

  for (const e of ents) {
    const orcId = e.orcamentos[0]?.id
    if (!orcId) continue
    const prevs = await prisma.previsaoReceita.findMany({
      where: { orcamentoId: orcId },
      select: { id: true, valorArrecadado: true, contaReceita: { select: { codigo: true, descricao: true } } },
    })
    const rows = prevs
      .filter((p) => Number(p.valorArrecadado) !== 0)
      .map((p) => {
        const arr = Number(p.valorArrecadado)
        const { tipo, deducaoTipo } = classificar(p.contaReceita?.codigo ?? '', p.contaReceita?.descricao ?? '', arr)
        return { previsaoId: p.id, tipo, deducaoTipo, valor: Math.abs(arr).toFixed(2), historico: HIST, data: new Date(Date.UTC(ANO, 11, 31)) }
      })
    if (!rows.length) { continue }
    const porTipo = rows.reduce<Record<string, number>>((m, r) => ((m[r.tipo] = (m[r.tipo] ?? 0) + 1), m), {})
    console.log(`  ${e.nome.slice(0, 40).padEnd(40)} ${rows.length} arrecadações [${Object.entries(porTipo).map(([t, n]) => `${t}:${n}`).join(' ')}]`)
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.arrecadacao.deleteMany({ where: { previsao: { orcamentoId: orcId }, historico: HIST } })
        await tx.arrecadacao.createMany({ data: rows })
      })
    }
  }
  console.log(APPLY ? '\n✅ Arrecadacao materializadas' : '\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
