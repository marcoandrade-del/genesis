/**
 * Importa a EXECUÇÃO DA RECEITA (arrecadação REALIZADA) da Prefeitura de Maringá
 * 2026 para dentro do banco, POR FONTE de recurso, a partir da captura mensal do
 * Portal da Transparência (`scripts/dados/receita-mensal-maringa-2026.json`,
 * gerada por scripts/capturar_receita_mensal_maringa.ts — #150).
 *
 * O portal publica a arrecadada apenas POR NATUREZA (mês a mês), não por fonte.
 * Atribuímos a fonte assim:
 *   - natureza com FONTE ÚNICA na LOA (81% dos casos) → atribuição direta/exata;
 *   - natureza com 2+ fontes → RATEIO proporcional ao valorPrevisto de cada fonte.
 * É aproximação por fonte; vira exata quando a arrecadada real por fonte vier da
 * Elotech (igual ao QDD da despesa). Ver [[contabil-regras-orcamentario]].
 *
 * Grava como DADO (insert direto de `Arrecadacao` tipo ARRECADACAO, data = fim do
 * mês, valor BRUTO `arrecadado`) e materializa `PrevisaoReceita.valorArrecadado`.
 * NÃO dispara contabilidade (E100/E200/E300): é execução capturada de Maringá
 * para os painéis/valores-mensais/saldo-por-fonte, não a escrituração contábil.
 * Idempotente: remove a própria importação anterior (por `historico`) antes.
 *
 * Dry-run por padrão (diferencia em memória e imprime — não grava). Grava: --apply.
 * Rodar: npx tsx scripts/importar_arrecadacao_maringa_2026.ts [--apply]
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const ANO = 2026
const JSON_PATH = 'scripts/dados/receita-mensal-maringa-2026.json'
const HISTORICO = 'Importação execução portal (arrecadada mensal)'

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// ── Códigos de receita (12 grupos), igual ao importador da LOA ───────────────
const GRUPOS_RECEITA = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2]
function agruparDigitos(raw: string): string {
  const partes: string[] = []
  let i = 0
  for (const g of GRUPOS_RECEITA) {
    if (i >= raw.length) break
    partes.push(raw.slice(i, i + g))
    i += g
  }
  return partes.join('.')
}
function pad12(codigo: string): string {
  const partes = codigo.split('.')
  for (let i = partes.length; i < 12; i++) partes.push('0'.repeat(GRUPOS_RECEITA[i]!))
  return partes.join('.')
}
function paiCodigo(codigo12: string): string | null {
  const partes = codigo12.split('.')
  for (let i = partes.length - 1; i >= 0; i--) {
    if (Number(partes[i]) !== 0) {
      if (i === 0) return null
      partes[i] = '0'.repeat(GRUPOS_RECEITA[i]!)
      return partes.join('.')
    }
  }
  return null
}
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface LinhaPortal { codigo: string; descricao: string; nivel: number; folha: boolean; arrecadado: number; deducao: number; realizadoLiquido: number }
interface MesPortal { mes: number; linhas: LinhaPortal[] }
interface CapturaReceita { exercicio: number; meses: MesPortal[] }

async function main() {
  console.log(`Arrecadação realizada (portal) → Gênesis (Maringá ${ANO})`)
  console.log(APPLY ? 'Modo: APLICAR (grava)\n' : 'Modo: dry-run (não grava)\n')

  const entidade = await prisma.entidade.findFirst({
    where: { tipo: 'PREFEITURA', municipio: { is: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } } } },
  })
  if (!entidade) throw new Error('Entidade PREFEITURA de Maringá/PR não encontrada.')
  const orcamento = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId: entidade.id, ano: ANO } } })
  if (!orcamento) throw new Error(`Orçamento ${ANO} de Maringá não encontrado (importe a LOA antes).`)
  console.log(`[banco] entidade ${entidade.nome} · orçamento ${orcamento.id} (${orcamento.status})`)

  // Previsões da LOA: conta(codigo12) → [{previsaoId, fonteCodigo, previsto}]
  const previsoes = await prisma.previsaoReceita.findMany({
    where: { orcamentoId: orcamento.id },
    select: { id: true, valorPrevisto: true, contaReceita: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } } },
  })
  const porConta = new Map<string, { previsaoId: string; fonteCodigo: string; previsto: number }[]>()
  for (const p of previsoes) {
    const cod = pad12(p.contaReceita.codigo)
    const arr = porConta.get(cod) ?? []
    arr.push({ previsaoId: p.id, fonteCodigo: p.fonteRecurso.codigo, previsto: Number(p.valorPrevisto) })
    porConta.set(cod, arr)
  }
  console.log(`[banco] previsões: ${previsoes.length} em ${porConta.size} naturezas`)

  // Captura do portal: folhas com arrecadado, por mês. codigo cru → codigo12.
  const captura = JSON.parse(readFileSync(JSON_PATH, 'utf-8')) as CapturaReceita
  // Acumula por (conta-previsão alvo) × mês, resolvendo a natureza ao ancestral que tem previsão.
  const contasComPrevisao = new Set(porConta.keys())
  function contaAlvo(codigo12: string): string | null {
    let c: string | null = codigo12
    while (c) {
      if (contasComPrevisao.has(c)) return c
      c = paiCodigo(c)
    }
    return null
  }

  // alvoConta → mes(1..12) → arrecadado(bruto)
  const porAlvoMes = new Map<string, Map<number, number>>()
  let totalPortal = 0
  let semPrevisao = 0
  for (const m of captura.meses) {
    for (const l of m.linhas) {
      if (!l.folha) continue
      const v = l.arrecadado || 0
      if (v === 0) continue
      totalPortal += v
      const cod12 = pad12(agruparDigitos(l.codigo))
      const alvo = contaAlvo(cod12)
      if (!alvo) { semPrevisao += v; continue }
      const porMes = porAlvoMes.get(alvo) ?? new Map<number, number>()
      porMes.set(m.mes, (porMes.get(m.mes) ?? 0) + v)
      porAlvoMes.set(alvo, porMes)
    }
  }

  // Distribui cada (alvo, mês) entre as fontes da natureza (proporcional ao previsto).
  type Mov = { previsaoId: string; mes: number; valor: number }
  const movs: Mov[] = []
  const porPrevisao = new Map<string, number>()
  let multiNatureza = 0
  for (const [alvo, porMes] of porAlvoMes) {
    const fontes = porConta.get(alvo)!
    const somaPrev = fontes.reduce((a, f) => a + f.previsto, 0)
    if (fontes.length > 1) multiNatureza++
    for (const [mes, valor] of porMes) {
      // pesos por fonte (proporcional ao previsto; se todas zero → igual)
      let acc = 0
      fontes.forEach((f, idx) => {
        const peso = somaPrev > 0 ? f.previsto / somaPrev : 1 / fontes.length
        // última fonte recebe o resíduo, para somar exatamente o valor do mês
        const parcela = idx === fontes.length - 1 ? Math.round((valor - acc) * 100) / 100 : Math.round(valor * peso * 100) / 100
        acc += parcela
        if (parcela === 0) return
        movs.push({ previsaoId: f.previsaoId, mes, valor: parcela })
        porPrevisao.set(f.previsaoId, (porPrevisao.get(f.previsaoId) ?? 0) + parcela)
      })
    }
  }

  const totalImportado = movs.reduce((a, m) => a + m.valor, 0)
  console.log(`\n[captura] meses: ${captura.meses.length}  · total arrecadado (bruto, folhas): R$ ${brl(totalPortal)}`)
  console.log(`[mapa] naturezas-alvo: ${porAlvoMes.size} (${multiNatureza} multi-fonte rateadas) · movimentos a criar: ${movs.length}`)
  console.log(`[mapa] total atribuído: R$ ${brl(totalImportado)}  · sem previsão (não atribuído): R$ ${brl(semPrevisao)}`)
  const cobertura = totalPortal ? (100 * (totalPortal - semPrevisao)) / totalPortal : 0
  console.log(`[mapa] cobertura: ${cobertura.toFixed(2)}% do arrecadado do portal\n`)

  if (!APPLY) {
    console.log('Dry-run: nada gravado. Rerun com --apply para gravar.')
    return
  }

  // ── Aplica em transação: limpa import anterior, insere, materializa ──────────
  const dataDeMes = (mes: number) => new Date(Date.UTC(ANO, mes, 0)) // último dia do mês
  const previsaoIds = previsoes.map((p) => p.id)
  await prisma.$transaction(async (tx) => {
    const del = await tx.arrecadacao.deleteMany({ where: { previsaoId: { in: previsaoIds }, historico: HISTORICO } })
    if (del.count) console.log(`[apply] removidos ${del.count} movimentos de importação anterior`)
    await tx.arrecadacao.createMany({
      data: movs.map((m) => ({ previsaoId: m.previsaoId, tipo: 'ARRECADACAO' as const, data: dataDeMes(m.mes), valor: m.valor, historico: HISTORICO })),
    })
    // Recompute valorArrecadado = Σ(ARRECADACAO) − Σ(ESTORNO) por previsão (preserva eventuais resíduos).
    for (const pid of previsaoIds) {
      const ag = await tx.arrecadacao.groupBy({ by: ['tipo'], where: { previsaoId: pid }, _sum: { valor: true } })
      let total = 0
      for (const g of ag) total += (g.tipo === 'ESTORNO' ? -1 : 1) * Number(g._sum.valor ?? 0)
      await tx.previsaoReceita.update({ where: { id: pid }, data: { valorArrecadado: total } })
    }
  })
  console.log(`[apply] OK: ${movs.length} movimentos de arrecadação criados; valorArrecadado materializado.`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })
