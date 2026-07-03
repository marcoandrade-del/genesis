/**
 * Importa a ARRECADAÇÃO de um MÊS da Prefeitura de Maringá direto da API do
 * Portal da Transparência (Elotech), POR NATUREZA×FONTE — sem depender do
 * relatório TCE-PR (que chega com 20–90 dias de atraso; o portal é tempo real).
 *
 * Fonte dos dados (descoberto em 2026-07-03):
 *   /api/receitas/fonte-recursos?entidade=1&exercicio=ANO            → fontes
 *   /api/receitas/fonte-recursos/detalhes?...&fonteRecurso=X
 *        &dataInicial=YYYY-MM-01&dataFinal=YYYY-MM-DD                → naturezas
 *   (o par dataInicial/dataFinal filtra o PERÍODO; valorArrecadado é BRUTO,
 *    como o import jan–mai do TCE gravou.)
 *
 * Persistência = idêntica ao importar_arrecadacao_maringa_2026.ts (#167):
 * movimentos `Arrecadacao` (ARRECADACAO, data fim do mês, valor bruto,
 * historico próprio por mês → idempotente) + rematerializa
 * PrevisaoReceita.valorArrecadado. Natureza×fonte sem previsão na LOA é
 * reportada e descartada (mesmo critério do jan–mai; cobertura esperada ~97%).
 *
 * Validação: Σ do mês × dashboard (/api/dashboard/arrecadacao-despesa, header
 * `entidade`) e acumulado × gabarito TCE (memória apurados-tce-2026).
 *
 * Rodar: npx tsx scripts/importar_arrecadacao_portal_2026.ts --mes 6 [--apply]
 */

import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const ANO = 2026
const BASE = 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'

const iMes = process.argv.indexOf('--mes')
const MES = iMes >= 0 ? parseInt(process.argv[iMes + 1] ?? '', 10) : NaN
if (!Number.isInteger(MES) || MES < 1 || MES > 12) {
  console.error('Informe o mês: --mes 6')
  process.exit(1)
}
const HISTORICO = `Importação execução portal (arrecadada ${String(MES).padStart(2, '0')}/${ANO})`

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// mesmos helpers de código do import jan–mai (12 grupos)
const GRUPOS = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2]
function agruparDigitos(raw: string): string {
  const partes: string[] = []
  let i = 0
  for (const g of GRUPOS) {
    if (i >= raw.length) break
    partes.push(raw.slice(i, i + g))
    i += g
  }
  return partes.join('.')
}
function pad12(codigo: string): string {
  const partes = codigo.replace(/\.+$/, '').split('.')
  for (let i = partes.length; i < 12; i++) partes.push('0'.repeat(GRUPOS[i]!))
  return partes.join('.')
}
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const c2 = (n: number) => Math.round(n * 100) / 100

async function getJson<T>(path: string): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const res = await fetch(`${BASE}${path}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (e) {
      if (tentativa >= 3) throw e
      await new Promise((r) => setTimeout(r, 1500 * tentativa))
    }
  }
}

type LinhaPortal = { receita: string; descricao: string; valorArrecadado: number; valorDeducao: number }

async function main() {
  const ultimoDia = new Date(Date.UTC(ANO, MES, 0)).getUTCDate()
  const dataIni = `${ANO}-${String(MES).padStart(2, '0')}-01`
  const dataFim = `${ANO}-${String(MES).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
  console.log(`Arrecadação ${dataIni} → ${dataFim} (portal, por natureza×fonte) → Gênesis`)
  console.log(APPLY ? 'Modo: APLICAR (grava)\n' : 'Modo: dry-run (não grava)\n')

  const entidade = await prisma.entidade.findFirstOrThrow({
    where: { tipo: 'PREFEITURA', municipio: { is: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } } } },
  })
  const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { entidadeId_ano: { entidadeId: entidade.id, ano: ANO } } })

  const previsoes = await prisma.previsaoReceita.findMany({
    where: { orcamentoId: orcamento.id },
    select: { id: true, contaReceita: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } } },
  })
  const previsaoDe = new Map<string, string>()
  for (const p of previsoes) previsaoDe.set(`${pad12(p.contaReceita.codigo)}|${p.fonteRecurso.codigo}`, p.id)
  console.log(`[banco] previsões: ${previsoes.length}`)

  // fontes do portal
  const fontes = await getJson<{ receita: string }[]>(`/api/receitas/fonte-recursos?entidade=1&exercicio=${ANO}`)
  console.log(`[portal] fontes: ${fontes.length}`)

  // varre fonte a fonte; usa só FOLHAS do retorno (nenhum outro código as estende)
  type Mov = { previsaoId: string; valor: number }
  const movs: Mov[] = []
  let totalBruto = 0
  let totalDeducao = 0
  let semPrevisao = 0
  const semPrevisaoDetalhe = new Map<string, number>()
  for (const f of fontes) {
    const linhas = await getJson<LinhaPortal[]>(
      `/api/receitas/fonte-recursos/detalhes?entidade=1&exercicio=${ANO}&fonteRecurso=${f.receita}&dataInicial=${dataIni}&dataFinal=${dataFim}`,
    )
    const codigos = linhas.map((l) => l.receita.replace(/\./g, ''))
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i]!
      if (!l.valorArrecadado && !l.valorDeducao) continue
      const raw = codigos[i]!
      const ehFolha = !codigos.some((c, j) => j !== i && c.startsWith(raw) && c.length > raw.length)
      if (!ehFolha) continue
      const nat = pad12(agruparDigitos(raw))
      const bruto = c2(l.valorArrecadado)
      totalBruto = c2(totalBruto + bruto)
      totalDeducao = c2(totalDeducao + (l.valorDeducao ?? 0))
      if (bruto === 0) continue
      const pid = previsaoDe.get(`${nat}|${f.receita}`)
      if (!pid) {
        semPrevisao = c2(semPrevisao + bruto)
        semPrevisaoDetalhe.set(`${nat}|${f.receita}`, c2((semPrevisaoDetalhe.get(`${nat}|${f.receita}`) ?? 0) + bruto))
        continue
      }
      movs.push({ previsaoId: pid, valor: bruto })
    }
  }
  const atribuido = c2(movs.reduce((s, m) => s + m.valor, 0))
  const cobertura = totalBruto ? (100 * atribuido) / totalBruto : 0
  console.log(`[portal] bruto do mês: R$ ${brl(totalBruto)} · deduções: R$ ${brl(totalDeducao)}`)
  console.log(`[mapa] movimentos: ${movs.length} · atribuído: R$ ${brl(atribuido)} · sem previsão: R$ ${brl(semPrevisao)} · cobertura ${cobertura.toFixed(2)}%`)
  const topDrop = [...semPrevisaoDetalhe.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  for (const [k, v] of topDrop) console.log(`   sem previsão: ${k} → R$ ${brl(v)}`)

  // validação contra o dashboard (mês)
  try {
    const dash = await (
      await fetch(`${BASE}/api/dashboard/arrecadacao-despesa?exercicio=${ANO}`, { headers: { entidade: '1' } })
    ).json() as { mes: number; valorArrecadado: number }[]
    const doMes = dash.find((m) => m.mes === MES)?.valorArrecadado ?? 0
    console.log(`[valida] dashboard mês ${MES}: R$ ${brl(doMes)} · Δ vs bruto: R$ ${brl(c2(totalBruto - doMes))}`)
  } catch {
    console.log('[valida] dashboard indisponível (segue sem)')
  }

  if (!APPLY) {
    console.log('\nDry-run: nada gravado. Rode com --apply.')
    return
  }

  const dataMov = new Date(Date.UTC(ANO, MES, 0))
  const previsaoIds = previsoes.map((p) => p.id)
  await prisma.$transaction(async (tx) => {
    const del = await tx.arrecadacao.deleteMany({ where: { previsaoId: { in: previsaoIds }, historico: HISTORICO } })
    if (del.count) console.log(`[apply] removidos ${del.count} movimentos de importação anterior deste mês`)
    await tx.arrecadacao.createMany({
      data: movs.map((m) => ({ previsaoId: m.previsaoId, tipo: 'ARRECADACAO' as const, data: dataMov, valor: m.valor, historico: HISTORICO })),
    })
    for (const pid of previsaoIds) {
      const ag = await tx.arrecadacao.groupBy({ by: ['tipo'], where: { previsaoId: pid }, _sum: { valor: true } })
      let total = 0
      for (const g of ag) total += (g.tipo === 'ESTORNO' ? -1 : 1) * Number(g._sum.valor ?? 0)
      await tx.previsaoReceita.update({ where: { id: pid }, data: { valorArrecadado: c2(total) } })
    }
  })
  const agg = await prisma.previsaoReceita.aggregate({ where: { orcamentoId: orcamento.id }, _sum: { valorArrecadado: true } })
  console.log(`[apply] OK: ${movs.length} movimentos; Σ arrecadado acumulado no banco: R$ ${brl(Number(agg._sum.valorArrecadado ?? 0))}`)
  console.log('(gabarito TCE até jun: R$ 1.732.158.223,59 — cobertura ~97% esperada)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
