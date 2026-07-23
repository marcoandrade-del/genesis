/**
 * BACKFILL do espelho das transferências financeiras: para cada TF RECEBIDA já
 * bookada (câmaras/fundos/RPPS, evento 900), booka a CONCEDIDA (evento 901,
 * D VPD 3.5.1.1.2.02 / C Caixa) na PREFEITURA do mesmo município — sem o espelho
 * o caixa do Executivo fica superavaliado exatamente no valor dos repasses.
 * O sync diário passa a bookar os dois lados sozinho; este script cobre o estoque.
 *
 * Idempotente: pula quando já existe CONCEDIDA na prefeitura com o mesmo
 * (data, valor, histórico-espelho) — o histórico carrega a entidade destino.
 * Exige a fonte da TF na prefeitura (senão reporta e pula; sem chute).
 *
 *   npx tsx scripts/espelhar_tf_concedidas.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { TransferenciasFinanceirasService } from '../src/services/transferencias-financeiras.js'

const APPLY = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: Prisma.Decimal | number) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

async function main() {
  console.log(`\n═══ Espelho das TFs concedidas ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  const svc = new TransferenciasFinanceirasService(prisma)

  const recebidas = await prisma.transferenciaFinanceira.findMany({
    where: { tipo: 'RECEBIDA' },
    select: { id: true, data: true, valor: true, fonteCodigo: true, entidade: { select: { nome: true, municipio: { select: { id: true, nome: true } } } } },
    orderBy: { data: 'asc' },
  })
  console.log(`${recebidas.length} TFs recebidas no dev.`)

  const prefeituras = new Map<string, { id: string; nome: string } | null>()
  let criadas = 0
  let puladas = 0
  const porMunicipio = new Map<string, Prisma.Decimal>()
  for (const tf of recebidas) {
    const munId = tf.entidade.municipio.id
    if (!prefeituras.has(munId)) {
      prefeituras.set(munId, await prisma.entidade.findFirst({ where: { municipioId: munId, nome: { contains: 'Prefeitura' } }, select: { id: true, nome: true } }))
    }
    const pref = prefeituras.get(munId)
    if (!pref) { console.log(`  ✗ ${tf.entidade.municipio.nome}: sem Prefeitura — TF ${tf.id} sem espelho`); continue }

    const data = tf.data.toISOString().slice(0, 10)
    const historico = `Espelho: repasse concedido a ${tf.entidade.nome} (${data})`
    const ja = await prisma.transferenciaFinanceira.findFirst({
      where: { entidadeId: pref.id, tipo: 'CONCEDIDA', data: tf.data, valor: tf.valor, historico },
      select: { id: true },
    })
    if (ja) { puladas++; continue }

    const ano = Number(data.slice(0, 4))
    const temFonte = await prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId: pref.id, ano, codigo: tf.fonteCodigo }, select: { id: true } })
    if (!temFonte) {
      // fonte existe no município (a recebedora usa) mas não como desdobramento da
      // prefeitura — cria copiando a nomenclatura (padrão garantirFonte do conversor)
      const modeloFonte = await prisma.fonteRecursoEntidade.findFirst({
        where: { codigo: tf.fonteCodigo, ano, entidade: { is: { municipioId: munId } } },
        select: { nomenclatura: true, vinculada: true },
      })
      if (!modeloFonte) { console.log(`  ✗ ${pref.nome}: fonte ${tf.fonteCodigo} inexistente no município — espelho de ${R(new Prisma.Decimal(tf.valor))} NÃO lançado`); continue }
      if (APPLY) {
        await prisma.fonteRecursoEntidade.create({
          data: { entidadeId: pref.id, ano, codigo: tf.fonteCodigo, nomenclatura: modeloFonte.nomenclatura, vinculada: modeloFonte.vinculada, origem: 'DESDOBRAMENTO' },
        })
      }
      console.log(`  + ${pref.nome}: fonte ${tf.fonteCodigo} criada (desdobramento, copiada da recebedora)`)
    }

    porMunicipio.set(tf.entidade.municipio.nome, (porMunicipio.get(tf.entidade.municipio.nome) ?? new Prisma.Decimal(0)).plus(new Prisma.Decimal(tf.valor)))
    if (APPLY) {
      await svc.registrar({ entidadeId: pref.id, tipo: 'CONCEDIDA', data, valor: String(tf.valor), fonteCodigo: tf.fonteCodigo, historico, criadoPorId: usuario.id })
    }
    criadas++
  }
  console.log(`\n${APPLY ? 'Criadas' : 'A criar'}: ${criadas} concedidas · já espelhadas: ${puladas}`)
  for (const [mun, v] of [...porMunicipio].sort()) console.log(`  ${mun}: Σ concedido ${R(v)}`)
  if (!APPLY) console.log('\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
