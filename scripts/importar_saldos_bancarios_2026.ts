import 'dotenv/config'
// execFileSync (não exec): sem shell, argumentos estáticos — sem risco de injection.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type TipoLancamento } from '@prisma/client'

/**
 * Importa os SALDOS BANCÁRIOS REAIS de Maringá (portal da transparência,
 * "Financeiro > Saldos de Contas Bancárias") para o Gênesis:
 *
 *  - Abertura: saldo de 31/12/2025 vira movimento de abertura em 01/01/2026
 *    (Σ validado ao centavo: R$ 775.079.908,05 = Balanço Financeiro = BP).
 *  - Mensal: cada mês publicado de 2026 vira um movimento de ajuste
 *    (saldo_mês − saldo_anterior) no fim do mês, por conta×fonte.
 *
 * Cadastro: uma ContaBancaria por conta×fonte (o PDF abre cada conta física
 * por fonte). A fonte de maior saldo fica com o número real; as demais ganham
 * sufixo "#fonte" no número (unique é banco+agência+número). Contas com saldo
 * sempre zero são ignoradas.
 *
 * Idempotente por lote: pula (conta, data) já importado no lote PORTAL_SALDOS.
 * Sem --apply, só imprime o diff. Requer `pdftotext` (poppler) no PATH.
 * Fecha o backlog "saldos bancários reais → nominal/DCL vivos".
 */

const BASE = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api/api/files/arquivo'
const CACHE = 'data/abertura-2026'
const LOTE = 'PORTAL_SALDOS_2026'
// idArquivo dos "Saldos de Contas Bancárias" (exercicio 2025 dez + 2026 jan–mai)
const MESES: { rotulo: string; idArquivo: number; dataMov: string }[] = [
  { rotulo: '31/12/2025 (abertura)', idArquivo: 2712615, dataMov: '2026-01-01' },
  { rotulo: 'JANEIRO/2026', idArquivo: 2898323, dataMov: '2026-01-31' },
  { rotulo: 'FEVEREIRO/2026', idArquivo: 2898324, dataMov: '2026-02-28' },
  { rotulo: 'MARÇO/2026', idArquivo: 2898325, dataMov: '2026-03-31' },
  { rotulo: 'ABRIL/2026', idArquivo: 2898326, dataMov: '2026-04-30' },
  { rotulo: 'MAIO/2026', idArquivo: 2898328, dataMov: '2026-05-31' },
]

const APPLY = process.argv.includes('--apply')

const br = (s: string) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.')) * 100) / 100
const r2 = (n: number) => Math.round(n * 100) / 100
const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface ContaInfo { descricao: string; banco: string; agencia: string; numero: string }
type Chave = string // banco|agencia|numero|fonte

async function baixarTexto(idArquivo: number, rotulo: string): Promise<string> {
  mkdirSync(CACHE, { recursive: true })
  const pdf = `${CACHE}/saldos_${idArquivo}.pdf`
  if (!existsSync(pdf)) {
    const res = await fetch(`${BASE}/${idArquivo}`)
    if (!res.ok) throw new Error(`download ${rotulo} falhou: HTTP ${res.status}`)
    writeFileSync(pdf, Buffer.from(await res.arrayBuffer()))
  }
  const txt = `${CACHE}/saldos_${idArquivo}.txt`
  execFileSync('pdftotext', ['-layout', pdf, txt])
  return readFileSync(txt, 'utf8')
}

/** Parse do relatório Elotech: blocos por conta (fecham em "Total agrupamento"),
 *  sub-linhas "… Fonte: NNNN  valor". Devolve saldo por conta×fonte + validação. */
function parseSaldos(txt: string, rotulo: string): { saldos: Map<Chave, number>; contas: Map<string, ContaInfo> } {
  const saldos = new Map<Chave, number>()
  const contas = new Map<string, ContaInfo>()
  const blocos = txt.split(/Total agrupamento:/)
  // local + descrição (lazy) + banco (1–3 díg.) + agência + conta + valor — a
  // cauda ancora o parse mesmo quando a descrição encosta no banco com 1 espaço
  // valor do cabeçalho tolerante (o pdftotext trunca casas em colunas largas) —
  // quem manda é a soma das sub-linhas × o "Total agrupamento"
  const hdrRe = /^\s*(\d+)\s+(.+?)\s+(\d{1,3})\s+([\d-]+)\s+(\S+)\s+(-?[\d.]+,\d{1,2})\s*$/m
  const subRe = /Fonte:\s*(\d{3,6})\s+(-?[\d.]+,\d{2})\s*$/gm
  let somaAgrupamentos = 0
  for (let i = 0; i < blocos.length - 1; i++) {
    const bloco = blocos[i]!
    // o valor do "Total agrupamento: X" ficou no início do bloco seguinte (split)
    const totalAg = blocos[i + 1]!.match(/^\s*(-?[\d.]+,\d{2})/)
    if (totalAg) somaAgrupamentos = r2(somaAgrupamentos + br(totalAg[1]!))
    const h = bloco.match(hdrRe)
    if (!h) {
      // bloco sem cabeçalho reconhecido: só é aceitável se não carrega valor
      if (totalAg && br(totalAg[1]!) !== 0) {
        throw new Error(`${rotulo}: bloco com total ${totalAg[1]} sem cabeçalho reconhecido — ajustar parser. Trecho:\n${bloco.slice(-300)}`)
      }
      continue
    }
    const [, , descricao, banco, agencia, numero] = h
    const chaveConta = `${banco!.padStart(3, '0')}|${agencia}|${numero}`
    if (!contas.has(chaveConta)) contas.set(chaveConta, { descricao: descricao!.trim(), banco: banco!.padStart(3, '0'), agencia: agencia!, numero: numero! })
    let m: RegExpExecArray | null
    subRe.lastIndex = 0
    while ((m = subRe.exec(bloco))) {
      const v = br(m[2]!)
      if (v === 0) continue
      const k: Chave = `${chaveConta}|${m[1]}`
      saldos.set(k, r2((saldos.get(k) ?? 0) + v))
    }
  }
  const somaFontes = r2([...saldos.values()].reduce((a, b) => a + b, 0))
  if (Math.abs(somaFontes - somaAgrupamentos) > 0.01) {
    throw new Error(`${rotulo}: Σ fontes ${fmt(somaFontes)} ≠ Σ agrupamentos ${fmt(somaAgrupamentos)} — parser desalinhado, ABORTANDO`)
  }
  console.log(`[${rotulo}] contas×fonte: ${saldos.size} · Σ ${fmt(somaFontes)} (validado vs agrupamentos)`)
  return { saldos, contas }
}

async function main() {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const entidade = await prisma.entidade.findFirst({
    where: { nome: { contains: 'Prefeitura' }, municipio: { nome: 'Maringá' } },
    select: { id: true, nome: true },
  })
  if (!entidade) throw new Error('Prefeitura de Maringá não encontrada')

  // 1) parse de todos os meses
  const meses: { rotulo: string; dataMov: string; saldos: Map<Chave, number>; contas: Map<string, ContaInfo> }[] = []
  for (const mdef of MESES) {
    const txt = await baixarTexto(mdef.idArquivo, mdef.rotulo)
    meses.push({ rotulo: mdef.rotulo, dataMov: mdef.dataMov, ...parseSaldos(txt, mdef.rotulo) })
  }

  // 2) movimentos = abertura (1º mês) + deltas entre meses consecutivos
  type Mov = { chave: Chave; data: string; valor: number; historico: string }
  const movimentos: Mov[] = []
  const infoConta = new Map<string, ContaInfo>()
  for (const m of meses) for (const [k, i] of m.contas) if (!infoConta.has(k)) infoConta.set(k, i)

  const chaves = new Set<Chave>()
  for (const m of meses) for (const k of m.saldos.keys()) chaves.add(k)

  let anterior = new Map<Chave, number>()
  for (let i = 0; i < meses.length; i++) {
    const m = meses[i]!
    for (const k of chaves) {
      const atual = m.saldos.get(k) ?? 0
      const delta = r2(atual - (anterior.get(k) ?? 0))
      if (delta !== 0) {
        movimentos.push({
          chave: k,
          data: m.dataMov,
          valor: delta,
          historico: i === 0 ? 'Saldo de abertura 2026 — portal (posição 31/12/2025)' : `Ajuste ao saldo do portal — ${m.rotulo}`,
        })
      }
    }
    anterior = m.saldos
  }

  // 3) resumo/validação
  const somaPorData = new Map<string, number>()
  for (const mv of movimentos) somaPorData.set(mv.data, r2((somaPorData.get(mv.data) ?? 0) + mv.valor))
  console.log('\nMovimentos a lançar:')
  for (const [d, v] of [...somaPorData].sort()) console.log(`  ${d}: Δ ${fmt(v)}`)
  const saldoFinal = r2([...somaPorData.values()].reduce((a, b) => a + b, 0))
  const alvoFinal = r2([...meses[meses.length - 1]!.saldos.values()].reduce((a, b) => a + b, 0))
  console.log(`Σ acumulado após todos os lançamentos: ${fmt(saldoFinal)} (alvo = saldo ${meses[meses.length - 1]!.rotulo}: ${fmt(alvoFinal)})`)
  if (Math.abs(saldoFinal - alvoFinal) > 0.01) throw new Error('Σ movimentos ≠ saldo final do último mês — ABORTANDO')

  if (!APPLY) {
    console.log(`\n(seco) contas×fonte a garantir: ${chaves.size} · movimentos: ${movimentos.length}. Rode com --apply para gravar.`)
    await prisma.$disconnect()
    return
  }

  // 4) upsert das contas (uma por conta×fonte; maior saldo de abertura fica com o número real)
  const abertura = meses[0]!.saldos
  const porConta = new Map<string, Chave[]>()
  for (const k of chaves) {
    const cc = k.slice(0, k.lastIndexOf('|'))
    porConta.set(cc, [...(porConta.get(cc) ?? []), k])
  }
  const idPorChave = new Map<Chave, string>()
  let contasNovas = 0
  for (const [cc, ks] of porConta) {
    const info = infoConta.get(cc)
    if (!info) throw new Error(`sem cabeçalho para a conta ${cc}`)
    const ordenadas = [...ks].sort((a, b) => Math.abs(abertura.get(b) ?? 0) - Math.abs(abertura.get(a) ?? 0))
    for (let j = 0; j < ordenadas.length; j++) {
      const k = ordenadas[j]!
      const fonte = k.slice(k.lastIndexOf('|') + 1)
      const numero = j === 0 ? info.numero : `${info.numero}#${fonte}`
      const existente = await prisma.contaBancaria.findUnique({
        where: { entidadeId_bancoCodigo_agencia_numero: { entidadeId: entidade.id, bancoCodigo: info.banco, agencia: info.agencia, numero } },
        select: { id: true },
      })
      if (existente) { idPorChave.set(k, existente.id); continue }
      const criada = await prisma.contaBancaria.create({
        data: {
          entidadeId: entidade.id, fonteCodigo: fonte, bancoCodigo: info.banco,
          agencia: info.agencia, numero,
          descricao: j === 0 ? info.descricao : `${info.descricao} (fonte ${fonte})`,
        },
        select: { id: true },
      })
      idPorChave.set(k, criada.id)
      contasNovas++
    }
  }

  // 5) movimentos (idempotente por conta+data no lote)
  let lancados = 0, pulados = 0
  for (const mv of movimentos) {
    const contaId = idPorChave.get(mv.chave)!
    const data = new Date(`${mv.data}T00:00:00Z`)
    const ja = await prisma.movimentoBancario.findFirst({ where: { contaBancariaId: contaId, data, loteImport: LOTE }, select: { id: true } })
    if (ja) { pulados++; continue }
    await prisma.movimentoBancario.create({
      data: {
        contaBancariaId: contaId, data,
        valor: Math.abs(mv.valor),
        sentido: (mv.valor >= 0 ? 'CREDITO' : 'DEBITO') as TipoLancamento,
        historico: mv.historico, origemImport: 'MANUAL', loteImport: LOTE,
      },
    })
    lancados++
  }
  console.log(`\n✅ contas novas: ${contasNovas} · movimentos lançados: ${lancados} · pulados (já no lote): ${pulados}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
