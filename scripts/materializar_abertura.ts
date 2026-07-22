/**
 * Materializa a ABERTURA do exercício (contabilização da LOA: previsão da receita
 * + fixação da despesa) das entidades de um município importado — pré-requisito
 * para o balancete orçamentário fechar (sem a abertura, o empenho deixa o crédito
 * disponível 6.2.2.1.1 DEVEDOR/invertido).
 *
 * Fluxo por entidade: publica a LOA (RASCUNHO→ENVIADO→APROVADO→PUBLICADO) e chama
 * `AberturaContabilService.contabilizar` (→ EM_EXECUCAO). Idempotente (pula quem já
 * está EM_EXECUCAO). Determinístico (contabiliza a LOA; não há Δ a reconciliar).
 *
 *   npx tsx scripts/materializar_abertura.ts <Município> [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { OrcamentosService } from '../src/services/orcamentos.js'
import { AberturaContabilService } from '../src/services/abertura-contabil.js'

const ANO = 2026
const APPLY = process.argv.includes('--apply')
const municipio = process.argv[2]
if (!municipio || municipio.startsWith('--')) {
  console.error('Uso: npx tsx scripts/materializar_abertura.ts <Município> [--apply]')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// caminho de publicação até PUBLICADO (a abertura exige LOA publicada)
const CAMINHO = ['ENVIADO_AO_LEGISLATIVO', 'APROVADO', 'PUBLICADO'] as const

async function main() {
  console.log(`\n═══ Abertura do exercício — ${municipio}/${ANO} ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  const orcs = new OrcamentosService(prisma)
  const abertura = new AberturaContabilService(prisma)
  const entidades = await prisma.entidade.findMany({
    where: { municipio: { nome: municipio } },
    select: { id: true, nome: true, orcamentos: { where: { ano: ANO }, select: { id: true, status: true } } },
    orderBy: { nome: 'asc' },
  })
  if (!entidades.length) throw new Error(`Nenhuma entidade no município '${municipio}'`)

  for (const e of entidades) {
    const orc = e.orcamentos[0]
    if (!orc) { console.log(`  ${e.nome}: SEM orçamento ${ANO} — pulando`); continue }
    if (orc.status === 'EM_EXECUCAO') { console.log(`  ${e.nome}: já EM_EXECUCAO (idempotente) — ok`); continue }

    // passos de publicação que faltam até PUBLICADO
    const idx = (CAMINHO as ReadonlyArray<string>).indexOf(orc.status)
    const faltam = idx === -1 ? CAMINHO : CAMINHO.slice(idx + 1)
    if (!APPLY) { console.log(`  ${e.nome}: status ${orc.status} → publicaria [${faltam.join('→')}] → contabilizaria abertura`); continue }

    for (const alvo of faltam) await orcs.alterarStatus(orc.id, alvo, usuario.id, 'Publicação p/ abertura contábil (conversor)')
    const r = await abertura.contabilizar(e.id, ANO, usuario.id)
    console.log(`  ${e.nome}: publicada + abertura contabilizada ✓ (${JSON.stringify(r).slice(0, 120)})`)
  }
  console.log(APPLY ? '\n✅ abertura concluída' : '\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
