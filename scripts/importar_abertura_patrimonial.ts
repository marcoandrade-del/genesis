/**
 * Import da ABERTURA PATRIMONIAL (classes 1-2) de QUALQUER município do
 * conversor, a partir da MSC oficial do SICONFI (`msc_patrimonial`,
 * beginning_balance de jan) — generalização do
 * `importar_abertura_msc_siconfi.ts` (que fez Maringá com os arquivos locais).
 *
 * Popula `SaldoInicialCc` (conta×fonte) + `SaldoInicialAno` (agregado) — a camada
 * que o balancete/MSC/saldo-contábil JÁ somam ao razão. Com isso o caixa 1.1.1.*
 * passa a ter o SALDO INICIAL de 31/12 e a prova de disponibilidade p/ restos a
 * pagar (art. 42 LRF) fica completa: inicial + fluxo do exercício.
 *
 * poder_orgao → entidade: usa o `matchSiconfi` do config do município quando
 * existir; senão heurística padrão (x0131=prefeitura · x0231=câmara ·
 * x0132=previdência/RPPS). Poder sem entidade = IGNORADO e quantificado (sem
 * chute). Conta sintética realoca no filho genérico .99 (regra do plano).
 * `valor`: magnitude na natureza da conta (negativo = saldo contrário).
 * Idempotente por substituição (apaga a abertura do ano da entidade e regrava).
 *
 *   npx tsx scripts/importar_abertura_patrimonial.ts --municipio=<nome> [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { baixarMscPatrimonial, type LinhaMscPatrimonial } from '../src/conversor/siconfi/api.js'
import type { MunicipioConfig } from '../src/conversor/nucleo/tipos.js'
import { cianortePr } from '../src/conversor/municipios/cianorte-pr.js'
import { criciumaSc } from '../src/conversor/municipios/criciuma-sc.js'
import { maringaPr } from '../src/conversor/municipios/maringa-pr.js'
import { naviraiMs } from '../src/conversor/municipios/navirai-ms.js'
import { paranaguaPr } from '../src/conversor/municipios/paranagua-pr.js'
import { paranaguaSiconfi } from '../src/conversor/municipios/paranagua-pr-siconfi.js'
import { sarandiPr } from '../src/conversor/municipios/sarandi-pr.js'
import { vilhenaRo } from '../src/conversor/municipios/vilhena-ro.js'

const APPLY = process.argv.includes('--apply')
const ANO = 2026
const alvo = process.argv.find((a) => a.startsWith('--municipio='))?.split('=')[1]
if (!alvo) { console.error('uso: --municipio=<nome> [--apply]'); process.exit(1) }

const CONFIGS: MunicipioConfig[] = [cianortePr, criciumaSc, maringaPr, naviraiMs, paranaguaPr, paranaguaSiconfi, sarandiPr, vilhenaRo]
/** IBGE p/ a API do SICONFI é o de 7 dígitos; corrige configs no formato TCE (6). */
const IBGE_FIX: Record<string, string> = { '411820': '4118204' }

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env['DATABASE_URL'] })) })
const r2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

/** "111111900" → "1.1.1.1.1.19.00.00.00.00.00.00" (12 segmentos do plano da entidade). */
function contaPara12Segmentos(c9: string): string {
  const s = [c9[0], c9[1], c9[2], c9[3], c9[4], c9.slice(5, 7), c9.slice(7, 9)]
  return [...s, '00', '00', '00', '00', '00'].join('.')
}

/** Entidade dona de um poder_orgao: matchSiconfi do config, senão heurística. */
function resolverEntidade(poder: string, cfg: MunicipioConfig, entidades: { id: string; nome: string }[]): { id: string; nome: string } | null {
  const porConfig = cfg.entidades.find((e) => e.matchSiconfi === poder)
  if (porConfig) return entidades.find((e) => e.nome === porConfig.nome) ?? null
  const baixa = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const acha = (frag: string[]) => entidades.find((e) => frag.some((f) => baixa(e.nome).includes(f))) ?? null
  if (/^1\d{2}31$/.test(poder)) return acha(['prefeitura'])
  if (/^2\d{2}31$/.test(poder)) return acha(['camara'])
  if (/^1\d{2}32$/.test(poder)) return acha(['previdencia', 'rpps', 'preserv', 'capseci'])
  return null
}

async function main() {
  const cfg = CONFIGS.find((c) => c.nome === alvo)
  if (!cfg) { console.error(`município '${alvo}' sem config (tenho: ${CONFIGS.map((c) => c.nome).join(' · ')})`); process.exitCode = 1; return }
  const ibge = IBGE_FIX[cfg.ibge] ?? cfg.ibge
  console.log(`\n═══ Abertura patrimonial — ${cfg.nome} (IBGE ${ibge}) bb jan/${ANO} ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)

  const linhas: LinhaMscPatrimonial[] = []
  for (const classe of ['1', '2'] as const) {
    const l = await baixarMscPatrimonial({ ibge, ano: ANO, mes: 1, classe, tipoValor: 'beginning_balance' })
    console.log(`  classe ${classe}: ${l.length} linhas`)
    linhas.push(...l)
  }
  if (!linhas.length) { console.log('MSC patrimonial de abertura VAZIA — ente não homologou? Nada a fazer.'); return }

  const entidades = await prisma.entidade.findMany({ where: { municipio: { is: { nome: cfg.nome } } }, select: { id: true, nome: true } })
  const poderes = [...new Set(linhas.map((l) => l.poder_orgao))].sort()
  const entPorPoder = new Map<string, { id: string; nome: string }>()
  for (const p of poderes) {
    const e = resolverEntidade(p, cfg, entidades)
    if (e) { entPorPoder.set(p, e); console.log(`  ${p} → ${e.nome}`) }
    else console.log(`  ${p} → SEM ENTIDADE (ignorado, quantificado abaixo)`)
  }

  // agrega por entidade × conta(12seg) × fonte, em débito com sinal (D−C)
  const agreg = new Map<string, number>()
  let valorIgnorado = 0
  for (const l of linhas) {
    const ent = entPorPoder.get(l.poder_orgao)
    if (!ent) { valorIgnorado += Math.abs(l.valor); continue }
    const k = `${ent.id}|${contaPara12Segmentos(l.conta_contabil)}|${l.fonte_recursos ?? ''}`
    agreg.set(k, (agreg.get(k) ?? 0) + l.valor * (l.natureza_conta === 'D' ? 1 : -1))
  }
  if (valorIgnorado) console.log(`  ⚠ Σ|valor| de poderes sem entidade: ${fmt(valorIgnorado)}`)

  // resolve contas (+ realocação de sintéticas no filho .99) e natureza do modelo
  const codigos = [...new Set([...agreg.keys()].map((k) => k.split('|')[1]!))]
  const entIds = [...entPorPoder.values()].map((e) => e.id)
  const contas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId: { in: entIds }, ano: ANO, codigo: { in: codigos } },
    select: { id: true, entidadeId: true, codigo: true, admiteMovimento: true, modeloContaId: true },
  })
  const sinteticas = contas.filter((c) => !c.admiteMovimento)
  const realoc = new Map<string, (typeof contas)[number]>()
  if (sinteticas.length) {
    const filhos = await prisma.contaContabilEntidade.findMany({
      where: { parentId: { in: sinteticas.map((c) => c.id) }, admiteMovimento: true },
      select: { id: true, entidadeId: true, codigo: true, admiteMovimento: true, modeloContaId: true, parentId: true },
    })
    const ehFilho99 = (pai: string, filho: string) => {
      const a = pai.split('.'), b = filho.split('.')
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] === '99'
      return false
    }
    for (const pai of sinteticas) {
      const f = filhos.find((x) => x.parentId === pai.id && ehFilho99(pai.codigo, x.codigo))
      if (f) realoc.set(`${pai.entidadeId}|${pai.codigo}`, f)
    }
  }
  const todas = [...contas, ...realoc.values()]
  const modeloIds = [...new Set(todas.map((c) => c.modeloContaId).filter((x): x is string => !!x))]
  const natPorModelo = new Map(
    (modeloIds.length ? await prisma.conta.findMany({ where: { id: { in: modeloIds } }, select: { id: true, naturezaSaldo: true } }) : []).map((m) => [m.id, m.naturezaSaldo]),
  )
  const contaPorChave = new Map(contas.map((c) => [`${c.entidadeId}|${c.codigo}`, c]))
  const natDe = (c: (typeof contas)[number]) => (c.modeloContaId ? natPorModelo.get(c.modeloContaId) : null)

  // conta AUSENTE no plano (desdobramento local do ente que o padrão não tem) →
  // ancestral existente mais próximo; se sintético, a folha genérica .99 dele.
  // Mesma regra da realocação de sintéticas — determinística, dirigida pelo plano.
  const cacheAncestral = new Map<string, (typeof contas)[number] | null>()
  const resolverAusente = async (entId: string, codigo: string): Promise<(typeof contas)[number] | null> => {
    const chave = `${entId}|${codigo}`
    if (cacheAncestral.has(chave)) return cacheAncestral.get(chave)!
    const segs = codigo.split('.')
    let achada: (typeof contas)[number] | null = null
    for (let corte = segs.length - 1; corte >= 3 && !achada; corte--) {
      if (/^0+$/.test(segs[corte]!)) continue
      const anc = segs.map((s, i) => (i < corte ? s : '0'.repeat(s.length))).join('.')
      const conta = await prisma.contaContabilEntidade.findFirst({
        where: { entidadeId: entId, ano: ANO, codigo: anc },
        select: { id: true, entidadeId: true, codigo: true, admiteMovimento: true, modeloContaId: true },
      })
      if (!conta) continue
      if (conta.admiteMovimento) achada = conta
      else {
        const filhos = await prisma.contaContabilEntidade.findMany({
          where: { parentId: conta.id, admiteMovimento: true },
          select: { id: true, entidadeId: true, codigo: true, admiteMovimento: true, modeloContaId: true },
        })
        const ehFilho99 = (pai: string, filho: string) => {
          const a = pai.split('.'), b = filho.split('.')
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] === '99'
          return false
        }
        // sem folha genérica: fica no PRÓPRIO nó sintético (SaldoInicial* não é
        // lançamento — o rollup soma certo) em vez de chutar outro ramo; o
        // desdobramento do plano estadual pode divergir do federal da MSC.
        achada = filhos.find((f) => ehFilho99(conta.codigo, f.codigo)) ?? conta
      }
    }
    if (achada?.modeloContaId && !natPorModelo.has(achada.modeloContaId)) {
      const m = await prisma.conta.findUnique({ where: { id: achada.modeloContaId }, select: { naturezaSaldo: true } })
      natPorModelo.set(achada.modeloContaId, m?.naturezaSaldo ?? null)
    }
    cacheAncestral.set(chave, achada)
    return achada
  }

  type Registro = { entidadeId: string; contaId: string; fonteCodigo: string; valor: number }
  const detalhes: Registro[] = []
  const stats = new Map<string, { ok: number; okValor: number; falhaValor: number; fechamento: number }>()
  const semConta = new Map<string, number>()
  const emSintetica = new Map<string, number>()
  for (const [k, v] of agreg) {
    const [entId, codigo, fonte] = k.split('|') as [string, string, string]
    const s = stats.get(entId) ?? { ok: 0, okValor: 0, falhaValor: 0, fechamento: 0 }
    stats.set(entId, s)
    let conta = contaPorChave.get(`${entId}|${codigo}`)
    if (conta && !conta.admiteMovimento) conta = realoc.get(`${entId}|${codigo}`)
    conta ??= (await resolverAusente(entId, codigo)) ?? undefined
    if (!conta) {
      semConta.set(codigo, (semConta.get(codigo) ?? 0) + Math.abs(v))
      s.falhaValor += Math.abs(v)
      continue
    }
    if (!conta.admiteMovimento) emSintetica.set(conta.codigo, r2((emSintetica.get(conta.codigo) ?? 0) + Math.abs(v)))
    const vr = r2(natDe(conta) === 'CREDORA' ? -v : v)
    if (vr === 0) continue
    detalhes.push({ entidadeId: entId, contaId: conta.id, fonteCodigo: fonte, valor: vr })
    s.ok++
    s.okValor += Math.abs(v)
    s.fechamento = r2(s.fechamento + v) // débito com sinal — ideal Δ0 no fim
  }
  // realocações (sintética/.99, ancestral) podem juntar várias contas de origem na
  // mesma folha×fonte — agrega antes de gravar (chave única do SaldoInicialCc)
  const porCcChave = new Map<string, Registro>()
  for (const d of detalhes) {
    const k = `${d.entidadeId}|${d.contaId}|${d.fonteCodigo}`
    const atual = porCcChave.get(k)
    if (atual) atual.valor = r2(atual.valor + d.valor)
    else porCcChave.set(k, { ...d })
  }
  const detalhesCc = [...porCcChave.values()].filter((d) => d.valor !== 0)

  console.log('\n─── cobertura + fechamento (Σ débito-com-sinal do importável; ideal Δ 0,00) ───')
  let falha = false
  for (const [entId, s] of stats) {
    const nome = [...entPorPoder.values()].find((e) => e.id === entId)?.nome
    const pct = s.okValor + s.falhaValor > 0 ? ((s.okValor / (s.okValor + s.falhaValor)) * 100).toFixed(2) : '100'
    const okFech = Math.abs(s.fechamento) < 0.01
    if (!okFech) falha = true
    console.log(`  ${nome}: ${s.ok} cc · cobertura ${pct}% (fora: ${fmt(s.falhaValor)}) · Δ ${fmt(s.fechamento)} ${okFech ? '✓' : '⚠'}`)
  }
  if (semConta.size) {
    console.log(`  contas fora do plano/sem folha .99 (${semConta.size}, top 8):`)
    for (const [c, v] of [...semConta].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${c}  ${fmt(v)}`)
  }
  if (emSintetica.size) {
    console.log(`  realocadas em nó SINTÉTICO (desdobramento estadual diverge do federal; ${emSintetica.size}, top 8):`)
    for (const [c, v] of [...emSintetica].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${c}  ${fmt(v)}`)
  }

  if (!APPLY) { console.log(`\nDRY-RUN — nada gravado (${detalhesCc.length} cc). Rode com --apply.`); return }
  if (falha) { console.log('\n⚠ fechamento com Δ ≥ 0,01 — confira a cobertura antes de aplicar. ABORTADO.'); process.exitCode = 1; return }

  for (const ent of entPorPoder.values()) {
    const meus = detalhesCc.filter((d) => d.entidadeId === ent.id)
    if (!meus.length) continue
    const porConta = new Map<string, number>()
    for (const d of meus) porConta.set(d.contaId, r2((porConta.get(d.contaId) ?? 0) + d.valor))
    await prisma.$transaction(async (tx) => {
      await tx.saldoInicialCc.deleteMany({ where: { entidadeId: ent.id, ano: ANO } })
      await tx.saldoInicialAno.deleteMany({ where: { entidadeId: ent.id, ano: ANO } })
      await tx.saldoInicialCc.createMany({
        data: meus.map((d) => ({ entidadeId: d.entidadeId, contaId: d.contaId, ano: ANO, fonteCodigo: d.fonteCodigo, valor: new Prisma.Decimal(d.valor) })),
      })
      await tx.saldoInicialAno.createMany({
        data: [...porConta.entries()].filter(([, v]) => v !== 0).map(([contaId, v]) => ({ entidadeId: ent.id, contaId, ano: ANO, valor: new Prisma.Decimal(v) })),
      })
    })
    console.log(`✓ ${ent.nome}: ${meus.length} cc + ${porConta.size} agregados gravados`)
  }
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
