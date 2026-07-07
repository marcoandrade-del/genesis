/**
 * SALDOS BANCÁRIOS oficiais → disponibilidade de caixa viva (DCL / RGF Anexo 5).
 *
 * Fonte: RGF ANEXO 5 CONSOLIDADO publicado no Portal da Transparência de
 * Maringá (1º quadrimestre/2026, corte 30/04 — idArquivo 2898552; conferido
 * com o Anexo 2 idArquivo 2898579: disponibilidade bruta 1.124,48mi − RP proc
 * 22,87mi = dedução 1.083,93mi → DCL oficial −539.616.064,25).
 *
 * O que grava: 1 ContaBancaria sintética por CATEGORIA do Anexo 5 (a
 * granularidade que o documento oficial tem) + 1 MovimentoBancario CRÉDITO
 * com o saldo bruto (coluna "a") datado no corte. FonteCodigo aponta a fonte
 * REAL mais representativa da categoria quando existe no catálogo da
 * Prefeitura; categorias sem fonte própria (RPPS, extraorçamentários…) usam
 * código sintético legível. A descrição da conta carrega o nome oficial.
 *
 * Quem consome: DisponibilidadeFonteService (Σ CRÉDITO−DÉBITO por conta) →
 * RGF Anexo 5 do app (lado caixa) e memorial DCL (dedução = caixa − RP proc).
 * ⚠️ Escopo CONSOLIDADO (município), coerente com a DC 544,32mi já semeada
 * nos cadastros do RGF. O Anexo 2 oficial EXCLUI parte do RPPS da dedução
 * (regra MDF) — refinamento fino do memorial DCL é follow-up de src/.
 *
 * Idempotente: apaga/regrava os movimentos do mesmo HISTORICO; reusa as
 * contas pelo campo `numero`. Dry-run por padrão; --apply grava em transação.
 *
 * Rodar: npx tsx scripts/importar_saldos_rgf_anexo5.ts [--apply]
 */

import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const CORTE = '2026-04-30'
const HISTORICO = `RGF Anexo 5 1ºQ/2026 — saldo oficial por categoria (corte ${CORTE})`

// Coluna (a) DISPONIBILIDADE DE CAIXA BRUTA, linhas-folha do Anexo 5 oficial
// (valores em centavos; Σ conferida contra TOTAL (IV) = 1.283.345.643,91).
const CATEGORIAS: { categoria: string; fonte: string; centavos: number }[] = [
  { categoria: 'Recursos Não Vinculados de Impostos', fonte: '1000', centavos: 36577593169 },
  { categoria: 'Outros Recursos não Vinculados', fonte: '11045', centavos: 19419826241 },
  { categoria: 'Transferências do FUNDEB', fonte: '1101', centavos: 2891362637 },
  { categoria: 'Outros Recursos Vinculados à Educação', fonte: '1104', centavos: 790737639 },
  { categoria: 'Transferências Fundo a Fundo de Recursos do SUS', fonte: '1486', centavos: 14318077244 },
  { categoria: 'Outros Recursos Vinculados à Saúde', fonte: '1303', centavos: 495025898 },
  { categoria: 'Recursos Vinculados à Assistência Social', fonte: '1260', centavos: 2757470376 },
  { categoria: 'Transferências de Convênios e Instrumentos Congêneres', fonte: '1290', centavos: 2477386814 },
  { categoria: 'Outras Vinculações Decorrentes de Transferências', fonte: 'VINC-TRANSF', centavos: 1783343334 },
  { categoria: 'Recursos de Operações de Crédito', fonte: '1257', centavos: 3916141550 },
  { categoria: 'Recursos de Alienação de Bens/Ativos', fonte: '1521', centavos: 5154358803 },
  { categoria: 'Recursos Vinculados a Fundos', fonte: 'VINC-FUNDOS', centavos: 5559624537 },
  { categoria: 'Outras Vinculações Legais', fonte: 'VINC-LEGAIS', centavos: 19404474898 },
  { categoria: 'Recursos Extraorçamentários', fonte: 'EXTRA-ORC', centavos: 1779690770 },
  { categoria: 'RPPS — Fundo em Capitalização (Plano Previdenciário)', fonte: 'RPPS-CAP', centavos: 7705991254 },
  { categoria: 'RPPS — Fundo em Repartição (Plano Financeiro)', fonte: 'RPPS-REP', centavos: 1394839351 },
  { categoria: 'RPPS — Taxa de Administração', fonte: 'RPPS-TAXA', centavos: 1908619876 },
]
const TOTAL_OFICIAL = 128334564391 // TOTAL (IV) do Anexo 5
const DCL_OFICIAL = 'DCL oficial 30/04 (Anexo 2): −539.616.064,25 · dedução 1.083.932.222,46'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (c: number): string =>
  (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  console.log(`\n═══ Import saldos RGF Anexo 5 1ºQ/2026 (${APPLY ? 'APPLY' : 'dry-run'}) ═══\n`)

  const soma = CATEGORIAS.reduce((s, c) => s + c.centavos, 0)
  if (soma !== TOTAL_OFICIAL) {
    console.error(`ABORTADO: Σ categorias ${reais(soma)} ≠ TOTAL oficial ${reais(TOTAL_OFICIAL)}`)
    process.exit(1)
  }
  console.log(`Σ categorias = TOTAL (IV) oficial: ${reais(TOTAL_OFICIAL)} ✓`)
  console.log(DCL_OFICIAL)

  const entidade = await prisma.entidade.findFirst({
    where: {
      tipo: 'PREFEITURA',
      municipio: { is: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } } },
    },
    select: { id: true, nome: true },
  })
  if (!entidade) throw new Error('entidade PREFEITURA de Maringá/PR não encontrada')

  console.log(`\nEntidade: ${entidade.nome}`)
  for (const c of CATEGORIAS) console.log(`  ${c.fonte.padEnd(12)} ${reais(c.centavos).padStart(18)}  ${c.categoria}`)

  if (!APPLY) {
    console.log('\nDry-run — nada gravado. Rode com --apply para gravar.\n')
    await prisma.$disconnect()
    return
  }

  const dataCorte = new Date(`${CORTE}T00:00:00Z`)
  await prisma.$transaction(async (tx) => {
    // apaga os movimentos deste import (idempotência) — contas são reusadas
    await tx.movimentoBancario.deleteMany({ where: { historico: HISTORICO, contaBancaria: { entidadeId: entidade.id } } })
    let n = 0
    for (const [i, c] of CATEGORIAS.entries()) {
      const numero = `RGF1Q26-${String(i + 1).padStart(2, '0')}`
      let conta = await tx.contaBancaria.findFirst({ where: { entidadeId: entidade.id, numero }, select: { id: true } })
      if (!conta) {
        conta = await tx.contaBancaria.create({
          data: {
            entidadeId: entidade.id,
            fonteCodigo: c.fonte,
            bancoCodigo: '000',
            bancoNome: 'CONSOLIDADO RGF (não é conta real)',
            agencia: '0000',
            numero,
            descricao: `Anexo 5 oficial 1ºQ/2026 — ${c.categoria}`,
          },
          select: { id: true },
        })
      }
      await tx.movimentoBancario.create({
        data: {
          contaBancariaId: conta.id,
          data: dataCorte,
          valor: c.centavos / 100,
          sentido: 'CREDITO',
          historico: HISTORICO,
          documento: 'idArquivo 2898552 (portal)',
        },
      })
      n++
    }
    console.log(`\nGravado: ${n} contas/moviments (histórico "${HISTORICO}").`)
  })

  // verificação: Σ caixa por conta importada = TOTAL oficial
  const agg = await prisma.movimentoBancario.aggregate({
    where: { historico: HISTORICO, contaBancaria: { entidadeId: entidade.id } },
    _sum: { valor: true },
  })
  const gravado = Math.round(Number(agg._sum.valor ?? 0) * 100)
  console.log(`Verificação: Σ gravado ${reais(gravado)} ${gravado === TOTAL_OFICIAL ? '✓ AO CENTAVO' : '≠ oficial (INVESTIGAR)'}`)
  console.log()
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('FALHOU:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
