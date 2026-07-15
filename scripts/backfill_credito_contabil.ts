/**
 * Backfill do espelho contábil dos créditos adicionais (decretos) — Prefeitura de
 * Maringá 2026. Regenera CIRURGICAMENTE só a FIXAÇÃO da abertura pelo valorINICIAL
 * (não toca previsão '001', transporte, nem a abertura patrimonial #252) e espelha
 * os 229 decretos pelo CreditoContabilService.
 *
 *   Antes:  fixação '002' = D 5.2.2.1.1.01 (autorizado 3.381,3mi) / C 6.2.2.1.1
 *   Depois: fixação '002' = D 5.2.2.1.1.01 (INICIAL 2.842,65mi)  / C 6.2.2.1.1
 *           + 229 créditos: reforço D 5.2.2.1.2.0X / C 6.2.2.1.1 ; anulação D 6.2.2.1.1 / C 5.2.2.1.3.09
 *   ⇒ 6.2.2.1.1 (disponível) volta a 3.381,3mi (= autorizado). Execução intacta.
 *
 * Uso: npx tsx scripts/backfill_credito_contabil.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { LancamentosService, type ItemDado } from '../src/services/lancamentos.js'
import { CreditoContabilService } from '../src/services/credito-contabil.js'
import { CONTAS_ABERTURA } from '../src/services/abertura-contabil.js'

const APPLY = process.argv.includes('--apply')
const E = 'b186d24e-5f2a-4378-831f-c0092b626384' // Prefeitura do Município (Maringá)
const ANO = 2026
const USUARIO = 'BACKFILL_CREDITO'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
const dec = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v)
const fmt = (v: Prisma.Decimal) => v.toFixed(2)

async function main() {
  const orcamento = await prisma.orcamento.findUnique({
    where: { entidadeId_ano: { entidadeId: E, ano: ANO } },
    include: {
      dotacoes: { include: { fonteRecurso: { select: { codigo: true } } } },
      creditos: { include: { itens: { select: { dotacaoDespesaId: true, operacao: true, valor: true } } } },
    },
  })
  if (!orcamento) throw new Error('orçamento não encontrado')

  // valorInicial por dotação = autorizado − (reforço − anulação)
  const creditoLiquido = new Map<string, Prisma.Decimal>()
  for (const c of orcamento.creditos)
    for (const it of c.itens) {
      const atual = creditoLiquido.get(it.dotacaoDespesaId) ?? dec(0)
      creditoLiquido.set(it.dotacaoDespesaId, it.operacao === 'REFORCO' ? atual.plus(it.valor) : atual.minus(it.valor))
    }

  // Contas de controle da fixação (folhas do plano da entidade).
  const contas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId: E, ano: ANO, codigo: { in: [CONTAS_ABERTURA.creditoInicial, CONTAS_ABERTURA.creditoDisponivel] }, admiteMovimento: true },
    select: { id: true, codigo: true },
  })
  const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]))
  const cInicial = idPorCodigo.get(CONTAS_ABERTURA.creditoInicial)!
  const cDisponivel = idPorCodigo.get(CONTAS_ABERTURA.creditoDisponivel)!

  const itensFixacao: ItemDado[] = []
  let totalInicial = dec(0)
  for (const d of orcamento.dotacoes) {
    const inicial = dec(d.valorAutorizado).minus(creditoLiquido.get(d.id) ?? 0)
    if (inicial.lessThanOrEqualTo(0)) continue
    const cc = { fonteCodigo: d.fonteRecurso.codigo, dotacaoDespesaId: d.id }
    itensFixacao.push({ contaId: cInicial, tipo: 'DEBITO', valor: inicial.toFixed(2), ...cc })
    itensFixacao.push({ contaId: cDisponivel, tipo: 'CREDITO', valor: inicial.toFixed(2), ...cc })
    totalInicial = totalInicial.plus(inicial)
  }

  const totalAutorizado = orcamento.dotacoes.reduce((a, d) => a.plus(d.valorAutorizado), dec(0))
  let totalRef = dec(0)
  let totalAnu = dec(0)
  for (const c of orcamento.creditos)
    for (const it of c.itens) (it.operacao === 'REFORCO' ? (totalRef = totalRef.plus(it.valor)) : (totalAnu = totalAnu.plus(it.valor)))

  console.log(`dotações: ${orcamento.dotacoes.length} · créditos: ${orcamento.creditos.length}`)
  console.log(`fixação HOJE (autorizado): ${fmt(totalAutorizado)}`)
  console.log(`fixação NOVA (inicial):    ${fmt(totalInicial)}  (${itensFixacao.length / 2} dotações)`)
  console.log(`créditos a espelhar: reforço ${fmt(totalRef)} · anulação ${fmt(totalAnu)}`)
  console.log(`disponível 6.2.2.1.1 esperado = inicial + reforço − anulação = ${fmt(totalInicial.plus(totalRef).minus(totalAnu))} (= autorizado ${fmt(totalAutorizado)})`)

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. --apply p/ regenerar a fixação e espelhar os créditos.')
    await prisma.$disconnect()
    return
  }

  const lancService = new LancamentosService(prisma)

  // 1) Apaga a(s) fixação(ões) '002' antiga(s), revertendo o materializado.
  const fixacoes = await prisma.lancamento.findMany({
    where: { entidadeId: E, origemTipo: 'ABERTURA', eventoCodigo: '002' },
    include: { itens: true },
  })
  await prisma.$transaction(async (tx) => {
    for (const lanc of fixacoes) {
      const mes = lanc.data.getUTCMonth() + 1
      const ladoAno = lanc.data.getUTCFullYear()
      const totais = new Map<string, { debito: Prisma.Decimal; credito: Prisma.Decimal }>()
      for (const i of lanc.itens) {
        const t = totais.get(i.contaId) ?? { debito: dec(0), credito: dec(0) }
        if (i.tipo === 'DEBITO') t.debito = t.debito.plus(i.valor)
        else t.credito = t.credito.plus(i.valor)
        totais.set(i.contaId, t)
      }
      for (const [contaId, { debito, credito }] of totais)
        await tx.resumoMensalConta.update({
          where: { entidadeId_contaId_ano_mes: { entidadeId: E, contaId, ano: ladoAno, mes } },
          data: { totalDebito: { decrement: debito }, totalCredito: { decrement: credito } },
        })
      await tx.lancamento.delete({ where: { id: lanc.id } })
    }
    // 2) Re-grava a fixação pelo INICIAL.
    await lancService.criar(
      { entidadeId: E, data: `${ANO}-01-01`, historico: 'Abertura do exercício — fixação da despesa (inicial)', itens: itensFixacao, criadoPorId: USUARIO, origemTipo: 'ABERTURA', origemId: orcamento.id, eventoCodigo: '002' },
      tx,
    )
  })
  console.log(`\nfixação regenerada pelo inicial (${fmt(totalInicial)}).`)

  // 3) Espelha os créditos adicionais.
  const resumo = await new CreditoContabilService(prisma).contabilizar(E, ANO, USUARIO)
  console.log(`créditos espelhados: ${resumo.creditos} · reforços ${resumo.reforcos} (${resumo.totalReforco}) · anulações ${resumo.anulacoes} (${resumo.totalAnulacao})`)

  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
