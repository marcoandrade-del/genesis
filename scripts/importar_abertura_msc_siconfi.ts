/**
 * Import da ABERTURA PATRIMONIAL (classes 1-2) a partir da MSC OFICIAL do
 * Siconfi (beginning_balance de jan/2026, baixada da API pública do Tesouro —
 * ver data/abertura-2026/msc_siconfi/ e a memória msc-siconfi-fonte-oficial).
 *
 * A MSC do ente 4115200 (Maringá) fecha POR poder_orgao (Δ 0,00 cada), então o
 * import é por entidade:
 *   10131 → Prefeitura do Município   (executivo sem RPPS; inclui as autarquias
 *            — Δ caixa +32,1mi vs relação bancária da Prefeitura, documentado)
 *   10132 → Maringá Previdência (RPPS)
 *   20231 → Câmara Municipal
 *
 * Escopo: classes 1 e 2 APENAS (3/4 abrem zeradas; 5-8 são a orçamentária que
 * o razão do Gênesis já constrói com os próprios eventos — importar duplicaria).
 *
 * Grava DUAS tabelas por contrato:
 *   - SaldoInicialCc  (detalhe conta×fonte — alimenta a MSC/atributo-F)
 *   - SaldoInicialAno (agregado por conta = Σ detalhe — balancete/consumidores)
 * `valor` em ambas: magnitude na natureza da conta (negativo = saldo contrário);
 * contas MISTA/sem natureza ficam em débito-com-sinal (Σ D−C).
 *
 * Idempotente por substituição: apaga a abertura (ano) da entidade e regrava.
 *
 * Uso:
 *   npx tsx scripts/importar_abertura_msc_siconfi.ts            # dry-run
 *   npx tsx scripts/importar_abertura_msc_siconfi.ts --apply    # grava (gated)
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const ANO = 2026
const DIR = 'data/abertura-2026/msc_siconfi'

// poder_orgao da MSC → como achar a entidade no banco (nome exato conferido no dry-run)
const PODER_ENTIDADE: Record<string, { nome: string }> = {
  '10131': { nome: 'Prefeitura do Município' },
  '10132': { nome: 'Maringá Previdência' },
  '20231': { nome: 'Câmara do Município' },
}

type LinhaMscOficial = {
  classe_conta: number
  conta_contabil: string // 9 dígitos, ex. "111111900"
  poder_orgao: string
  fonte_recursos: string | null
  ano_fonte_recursos: number | null
  valor: number
  natureza_conta: 'D' | 'C'
}

/** "111111900" → "1.1.1.1.1.19.00.00.00.00.00.00" (12 segmentos do plano da entidade). */
function contaPara12Segmentos(c9: string): string {
  const s = [c9[0], c9[1], c9[2], c9[3], c9[4], c9.slice(5, 7), c9.slice(7, 9)]
  return [...s, '00', '00', '00', '00', '00'].join('.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const r2 = (x: number) => Math.round(x * 100) / 100
const fmt = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

async function main() {
  // 1. Carrega as linhas oficiais (classes 1-2, beginning_balance jan/2026)
  const linhas: LinhaMscOficial[] = []
  for (const cl of [1, 2]) {
    const d = JSON.parse(readFileSync(`${DIR}/mscc_2026-01_bb_classe${cl}.json`, 'utf-8'))
    linhas.push(...d.items)
  }
  console.log(`MSC oficial: ${linhas.length} linhas (classes 1-2, bb jan/${ANO})`)

  // 2. Resolve as entidades (Maringá) por nome
  const entidades = await prisma.entidade.findMany({
    where: { municipio: { nome: 'Maringá' } },
    select: { id: true, nome: true },
  })
  const entPorPoder = new Map<string, { id: string; nome: string }>()
  for (const [poder, cfg] of Object.entries(PODER_ENTIDADE)) {
    const e = entidades.find((x) => x.nome.includes(cfg.nome))
    if (!e) throw new Error(`entidade não encontrada p/ poder_orgao ${poder} ("${cfg.nome}") — entidades: ${entidades.map((x) => x.nome).join(' | ')}`)
    entPorPoder.set(poder, e)
    console.log(`  ${poder} → ${e.nome} (${e.id})`)
  }

  // 3. Agrega por entidade × conta(12seg) × fonte, em débito com sinal (D−C)
  type Chave = string // entId|codigo12|fonte
  const agreg = new Map<Chave, number>()
  const poderesIgnorados = new Map<string, number>()
  for (const l of linhas) {
    const ent = entPorPoder.get(l.poder_orgao)
    if (!ent) {
      poderesIgnorados.set(l.poder_orgao, (poderesIgnorados.get(l.poder_orgao) ?? 0) + 1)
      continue
    }
    const codigo = contaPara12Segmentos(l.conta_contabil)
    const fonte = l.fonte_recursos ?? ''
    const k = `${ent.id}|${codigo}|${fonte}`
    agreg.set(k, (agreg.get(k) ?? 0) + l.valor * (l.natureza_conta === 'D' ? 1 : -1))
  }
  if (poderesIgnorados.size) console.log('poder_orgao IGNORADOS:', [...poderesIgnorados.entries()].map(([p, n]) => `${p}(${n})`).join(' '))

  // distribuição de ano_fonte (visibilidade — 2 = exercícios anteriores)
  const porAnoFonte = new Map<number | null, number>()
  for (const l of linhas) porAnoFonte.set(l.ano_fonte_recursos, (porAnoFonte.get(l.ano_fonte_recursos) ?? 0) + 1)
  console.log('ano_fonte_recursos:', [...porAnoFonte.entries()].map(([a, n]) => `${a}=${n}`).join(' '))

  // 4. Resolve contas do plano das entidades (ano 2026) e a natureza do modelo
  const codigos = [...new Set([...agreg.keys()].map((k) => k.split('|')[1]))]
  const contas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId: { in: [...entPorPoder.values()].map((e) => e.id) }, ano: ANO, codigo: { in: codigos } },
    select: { id: true, entidadeId: true, codigo: true, admiteMovimento: true, modeloContaId: true },
  })
  // Conta SINTÉTICA no nosso plano (desdobramento local que a MSC agregada não
  // conhece) → realoca no filho genérico ".99" quando ele existe e é analítico.
  // É a conta prevista pelo próprio plano para o não-especificado — determinístico.
  const sinteticas = contas.filter((c) => !c.admiteMovimento)
  const realoc = new Map<string, { id: string; entidadeId: string; codigo: string; admiteMovimento: boolean; modeloContaId: string | null }>()
  if (sinteticas.length) {
    const paisIds = sinteticas.map((c) => c.id)
    const filhos99 = await prisma.contaContabilEntidade.findMany({
      where: { parentId: { in: paisIds }, admiteMovimento: true },
      select: { id: true, entidadeId: true, codigo: true, admiteMovimento: true, modeloContaId: true, parentId: true },
    })
    // filho genérico = o primeiro segmento em que o código difere do pai é "99"
    const ehFilho99 = (pai: string, filho: string) => {
      const a = pai.split('.'), b = filho.split('.')
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] === '99'
      return false
    }
    for (const pai of sinteticas) {
      const f = filhos99.find((x) => x.parentId === pai.id && ehFilho99(pai.codigo, x.codigo))
      if (f) realoc.set(`${pai.entidadeId}|${pai.codigo}`, f)
    }
  }

  const todas = [...contas, ...[...realoc.values()]]
  const modeloIds = [...new Set(todas.map((c) => c.modeloContaId).filter((x): x is string => !!x))]
  const naturezas = modeloIds.length
    ? await prisma.conta.findMany({ where: { id: { in: modeloIds } }, select: { id: true, naturezaSaldo: true } })
    : []
  const natPorModelo = new Map(naturezas.map((m) => [m.id, m.naturezaSaldo]))
  const contaPorChave = new Map(contas.map((c) => [`${c.entidadeId}|${c.codigo}`, c]))

  // 5. Monta as gravações + relatório de cobertura por entidade
  type Registro = { entidadeId: string; contaId: string; fonteCodigo: string; valor: number }
  const detalhes: Registro[] = []
  const problemas = { semConta: new Map<string, number>(), sintetica: new Map<string, number>(), realocadas: new Map<string, number>() }
  const porEntidade = new Map<string, { ok: number; okValor: number; falhaValor: number }>()
  for (const [k, v] of agreg) {
    const [entId, codigo, fonte] = k.split('|')
    const stats = porEntidade.get(entId) ?? { ok: 0, okValor: 0, falhaValor: 0 }
    porEntidade.set(entId, stats)
    let conta = contaPorChave.get(`${entId}|${codigo}`)
    if (!conta) {
      problemas.semConta.set(codigo, (problemas.semConta.get(codigo) ?? 0) + 1)
      stats.falhaValor += Math.abs(v)
      continue
    }
    if (!conta.admiteMovimento) {
      const filho = realoc.get(`${entId}|${codigo}`)
      if (!filho) {
        problemas.sintetica.set(codigo, (problemas.sintetica.get(codigo) ?? 0) + 1)
        stats.falhaValor += Math.abs(v)
        continue
      }
      problemas.realocadas.set(`${codigo} → ${filho.codigo}`, (problemas.realocadas.get(`${codigo} → ${filho.codigo}`) ?? 0) + 1)
      conta = filho
    }
    const natureza = conta.modeloContaId ? natPorModelo.get(conta.modeloContaId) : null
    // magnitude na natureza da conta (o emissor/balancete des-negam pela natureza)
    const valorNat = natureza === 'CREDORA' ? -v : v
    const vr = r2(valorNat)
    if (vr === 0) continue
    detalhes.push({ entidadeId: entId, contaId: conta.id, fonteCodigo: fonte, valor: vr })
    stats.ok++
    stats.okValor += Math.abs(v)
  }

  console.log('\n=== cobertura por entidade ===')
  for (const [entId, s] of porEntidade) {
    const nome = [...entPorPoder.values()].find((e) => e.id === entId)?.nome
    const pct = s.okValor + s.falhaValor > 0 ? ((s.okValor / (s.okValor + s.falhaValor)) * 100).toFixed(2) : '100'
    console.log(`  ${nome}: ${s.ok} registros ok · valor coberto ${pct}% · sem cobertura ${fmt(s.falhaValor)}`)
  }
  if (problemas.semConta.size) {
    console.log(`\ncontas AUSENTES no plano (${problemas.semConta.size}):`)
    for (const [c, n] of [...problemas.semConta].slice(0, 15)) console.log(`  ${c} (${n} cc)`)
  }
  if (problemas.realocadas.size) {
    console.log(`\nsintéticas REALOCADAS no filho genérico .99 (${problemas.realocadas.size}):`)
    for (const [c, n] of problemas.realocadas) console.log(`  ${c} (${n} cc)`)
  }
  if (problemas.sintetica.size) {
    console.log(`\ncontas SINTÉTICAS sem filho .99 — NÃO importadas (${problemas.sintetica.size}):`)
    for (const [c, n] of [...problemas.sintetica].slice(0, 15)) console.log(`  ${c} (${n} cc)`)
  }

  // fechamento do que SERÁ importado, por entidade (em débito com sinal)
  console.log('\n=== fechamento do importável (Σ débito-com-sinal por entidade; ideal ≈ 0) ===')
  const fech = new Map<string, number>()
  for (const d of detalhes) {
    // volta à convenção débito-com-sinal p/ conferir fechamento
    const conta = todas.find((c) => c.id === d.contaId)!
    const natureza = conta.modeloContaId ? natPorModelo.get(conta.modeloContaId) : null
    const dev = natureza === 'CREDORA' ? -d.valor : d.valor
    fech.set(d.entidadeId, (fech.get(d.entidadeId) ?? 0) + dev)
  }
  for (const [entId, v] of fech) {
    const nome = [...entPorPoder.values()].find((e) => e.id === entId)?.nome
    console.log(`  ${nome}: Δ ${fmt(r2(v))}`)
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — nada gravado. Registros a gravar: ${detalhes.length} detalhe + agregados. Rode com --apply.`)
    await prisma.$disconnect()
    return
  }

  // 6. APPLY — por entidade, em transação: substitui a abertura do ano
  for (const ent of entPorPoder.values()) {
    const meus = detalhes.filter((d) => d.entidadeId === ent.id)
    // agregado por conta = Σ detalhe
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
    console.log(`APPLY ${ent.nome}: ${meus.length} detalhe + ${porConta.size} agregados gravados`)
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
