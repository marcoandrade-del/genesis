/**
 * Atribui FONTE REAL às transferências financeiras (evento 900/901) das CÂMARAS
 * dos municípios Elotech, hoje bookadas com a fonte genérica 9999 (o portal não
 * discrimina a fonte do repasse) — SÓ ATRIBUIÇÃO EXATA, sem rateio:
 *
 *   A Câmara tem poder_orgao PRÓPRIO na MSC oficial (20231). Se TODO o caixa
 *   dela (contas 1.1.1.*, classe 1, por fonte) vive numa ÚNICA fonte, o repasse
 *   que o alimenta é dessa fonte — evidência do próprio ente, imune a timing
 *   (a fonte não depende de valores). Fontes da família extraorçamentária
 *   (1.850–1.869, retenções/consignações/cauções em que o ente é mero
 *   DEPOSITÁRIO — Portaria STN 710/2021 e atualizações) não são fonte de
 *   transferência financeira por definição normativa e ficam fora do teste.
 *
 *   Os FUNDOS não têm poder_orgao próprio (consolidados no 10131 junto com a
 *   Prefeitura) → sem evidência oficial por fundo; suas TFs FICAM 9999,
 *   quantificadas no relatório.
 *
 * NENHUM valor muda: o script re-keya `TransferenciaFinanceira.fonteCodigo`
 * (recebida da Câmara + espelho concedido na Prefeitura, casado pelo histórico
 * "Espelho: repasse concedido a <nome>") e realinha o `fonteCodigo` dos itens
 * do razão dessas TFs (cc fonte nas duas pernas). Prova Σ por entidade
 * inalterado. Idempotente (re-run sem 9999 = no-op).
 *
 *   npx tsx scripts/atribuir_fonte_tf_camaras_msc.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { baixarMscPatrimonial } from '../src/conversor/siconfi/api.js'

const APPLY = process.argv.includes('--apply')
const ANO = 2026

const MUNICIPIOS = [
  { nome: 'Cianorte', ibge: '4105508', camara: 'Câmara Municipal de Cianorte' },
  { nome: 'Naviraí', ibge: '5005707', camara: 'Câmara Municipal de Naviraí' },
  { nome: 'Vilhena', ibge: '1100304', camara: 'Câmara Municipal de Vilhena' },
  { nome: 'Sarandi', ibge: '4126256', camara: 'Câmara Municipal de Sarandi' },
]
const PO_CAMARA = '20231'
const EXTRAORCAMENTARIA = /^18[5-6]\d$/ // 1850–1869: ente depositário, nunca fonte de TF

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

/** Fontes (STN 4-díg) com movimento no caixa 1.1.1.* do poder na MSC, último mês homologado. */
async function fontesCaixaCamara(ibge: string): Promise<{ mes: number; fontes: Map<string, number> }> {
  for (let mes = 12; mes >= 1; mes--) {
    const linhas = await baixarMscPatrimonial({ ibge, ano: ANO, mes, classe: '1', tipoValor: 'ending_balance' })
    if (!linhas.length) continue
    const fontes = new Map<string, number>()
    for (const l of linhas) {
      if (l.poder_orgao !== PO_CAMARA || !l.conta_contabil.startsWith('111') || !l.fonte_recursos) continue
      fontes.set(l.fonte_recursos, (fontes.get(l.fonte_recursos) ?? 0) + (l.natureza_conta === 'D' ? l.valor : -l.valor))
    }
    return { mes, fontes }
  }
  return { mes: 0, fontes: new Map() }
}

/** Garante a fonte STN no catálogo da entidade; devolve o código a usar no cc. */
async function garantirFonte(entidadeId: string, municipioNome: string, stn: string): Promise<string> {
  const exata = await prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId, ano: ANO, codigo: stn }, select: { codigo: true } })
  if (exata) return exata.codigo
  const nome: { nomenclatura: string }[] = await prisma.$queryRawUnsafe(
    `SELECT f.nomenclatura FROM fontes_recurso_entidade f
     JOIN entidades e ON e.id = f."entidadeId" JOIN municipios m ON m.id = e."municipioId"
     WHERE m.nome = $1 AND (f.codigo = $2 OR f.codigo LIKE $3) LIMIT 1`, municipioNome, stn, `${stn}%`)
  await prisma.fonteRecursoEntidade.create({
    data: { entidadeId, ano: ANO, codigo: stn, nomenclatura: nome[0]?.nomenclatura ?? `Fonte STN ${stn}`, vinculada: !/^150\d$/.test(stn), origem: 'DESDOBRAMENTO' },
  })
  return stn
}

/** Re-keya as TFs (fonte 9999 → stn) e realinha o cc dos itens do razão. Retorna [tfs, itens]. */
async function rekey(tfIds: string[], fonte: string): Promise<[number, number]> {
  if (!tfIds.length) return [0, 0]
  return prisma.$transaction(async (tx) => {
    const tfs = await tx.transferenciaFinanceira.updateMany({ where: { id: { in: tfIds } }, data: { fonteCodigo: fonte } })
    const itens: number = await tx.$executeRawUnsafe(
      `UPDATE lancamento_itens li SET "fonteCodigo" = $1
       FROM lancamentos l
       WHERE l.id = li."lancamentoId" AND l."origemTipo" = 'TRANSFERENCIA_FINANCEIRA'
         AND l."origemId" = ANY($2) AND li."fonteCodigo" IS DISTINCT FROM $1`, fonte, tfIds)
    return [tfs.count, itens]
  })
}

async function main() {
  console.log(`═══ Fonte real das TFs das Câmaras via MSC (caixa por fonte do poder 20231) ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  for (const mun of MUNICIPIOS) {
    const { mes, fontes } = await fontesCaixaCamara(mun.ibge)
    const relevantes = [...fontes.entries()].filter(([f]) => !EXTRAORCAMENTARIA.test(f))
    const extra = [...fontes.entries()].filter(([f]) => EXTRAORCAMENTARIA.test(f))
    console.log(`\n─── ${mun.nome} (MSC mês ${mes}) — caixa da Câmara por fonte:`)
    for (const [f, v] of fontes) console.log(`    ${f}${EXTRAORCAMENTARIA.test(f) ? ' [extraorçamentária — fora do teste]' : ''}: ${R(v)}`)
    if (relevantes.length !== 1) {
      console.log(`  ✗ sem fonte ÚNICA (${relevantes.length} candidatas) — TFs ficam 9999.`)
      continue
    }
    const stn = relevantes[0]![0]
    console.log(`  ✓ fonte única: ${stn}${extra.length ? ` (excluídas ${extra.map(([f]) => f).join(',')} por norma)` : ''}`)

    const camara = await prisma.entidade.findFirst({ where: { nome: mun.camara, municipio: { is: { nome: mun.nome } } }, select: { id: true } })
    const pref = await prisma.entidade.findFirst({ where: { nome: { contains: 'Prefeitura' }, municipio: { is: { nome: mun.nome } } }, select: { id: true } })
    if (!camara || !pref) { console.log('  ✗ câmara/prefeitura não encontrada no banco — pulando.'); continue }

    const recebidas = await prisma.transferenciaFinanceira.findMany({ where: { entidadeId: camara.id, tipo: 'RECEBIDA', fonteCodigo: '9999' }, select: { id: true, valor: true } })
    const espelhos = await prisma.transferenciaFinanceira.findMany({
      where: { entidadeId: pref.id, tipo: 'CONCEDIDA', fonteCodigo: '9999', historico: { startsWith: `Espelho: repasse concedido a ${mun.camara}` } },
      select: { id: true, valor: true },
    })
    const soma = (l: { valor: unknown }[]) => l.reduce((s, t) => s + Number(t.valor), 0)
    console.log(`  TFs 9999 da Câmara: ${recebidas.length} (Σ ${R(soma(recebidas))}) · espelhos na Prefeitura: ${espelhos.length} (Σ ${R(soma(espelhos))})`)
    if (Math.abs(soma(recebidas) - soma(espelhos)) > 0.005) console.log('  ⚠️ recebidas ≠ espelhos — conferir espelhamento (re-key segue mesmo assim, cada lado pelo seu dado)')
    if (!recebidas.length && !espelhos.length) { console.log('  nada a re-keyar (idempotente).'); continue }
    if (!APPLY) continue

    const fonteCamara = await garantirFonte(camara.id, mun.nome, stn)
    const fontePref = await garantirFonte(pref.id, mun.nome, stn)
    const [tfR, itR] = await rekey(recebidas.map((t) => t.id), fonteCamara)
    const [tfC, itC] = await rekey(espelhos.map((t) => t.id), fontePref)
    console.log(`  ✓ re-keyado: Câmara ${tfR} TFs/${itR} itens → ${fonteCamara} · Prefeitura ${tfC} TFs/${itC} itens → ${fontePref}`)
  }

  // quantificação do que FICA 9999 (fundos, sem evidência oficial por fundo)
  const resto: { municipio: string; entidade: string; tipo: string; n: number; total: number }[] = await prisma.$queryRawUnsafe(`
    SELECT m.nome AS municipio, e.nome AS entidade, tf.tipo::text AS tipo, COUNT(*)::int AS n, SUM(tf.valor)::float AS total
    FROM transferencias_financeiras tf
    JOIN entidades e ON e.id = tf."entidadeId" JOIN municipios m ON m.id = e."municipioId"
    WHERE tf."fonteCodigo" = '9999' GROUP BY 1,2,3 ORDER BY 1,2`)
  console.log(`\n─── Ficam 9999 (sem evidência oficial por fundo — consolidados no po 10131):`)
  for (const r of resto) console.log(`  ${r.municipio} · ${r.entidade} [${r.tipo}] n=${r.n} Σ=${R(r.total)}`)
  if (!APPLY) console.log('\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
