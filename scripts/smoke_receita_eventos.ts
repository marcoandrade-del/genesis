/**
 * Smoke AO VIVO do disparo contábil da arrecadação (Motor da Receita table-driven).
 *
 * Faz uma arrecadação real numa previsão de Maringá, confere os lançamentos gerados
 * pela Tabela de Eventos (E100/E200/+patrimonial), valida partida dobrada (ΣD=ΣC) e
 * a conta-corrente, faz um estorno e **limpa tudo ao final** (try/finally).
 *
 *   npx tsx scripts/smoke_receita_eventos.ts            # DRY-RUN (recon)
 *   npx tsx scripts/smoke_receita_eventos.ts --apply    # roda e limpa
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { ArrecadacoesService } from '../src/services/arrecadacoes.js'
import { LancamentosService } from '../src/services/lancamentos.js'

const APLICAR = process.argv.includes('--apply')
const VALOR = '1.00'
const ESTORNO = '0.30'
const SUFFIX = `SMOKE-${Date.now()}`
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const log = (s = '') => console.log(s)
const money = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v).toFixed(2)

async function main() {
  log(`Smoke disparo receita — ${APLICAR ? 'APPLY (roda e limpa)' : 'DRY-RUN (recon)'}\n`)

  const orcamento = await prisma.orcamento.findFirst({
    where: { status: { in: ['EM_EXECUCAO', 'APROVADO'] } },
    orderBy: { ano: 'desc' },
    include: { entidade: { select: { id: true, nome: true } } },
  })
  if (!orcamento) throw new Error('Nenhum orçamento EM_EXECUCAO/APROVADO.')
  log(`Entidade: ${orcamento.entidade.nome}  | orçamento ${orcamento.ano} (${orcamento.status})`)

  // Modelo + de/para da receita (p/ achar uma previsão cuja natureza dispara o patrimonial).
  const modeloId = await resolverModelo(orcamento.entidadeId)
  const paramsReceita = modeloId ? await prisma.parametroReceita.findMany({ where: { modeloContabilId: modeloId } }) : []
  log(`De/para da receita no modelo: ${paramsReceita.length} linha(s)`)

  // Previsão: preferir uma cuja natureza casa um de/para (assim dispara E300/400/500/560).
  const previsoes = await prisma.previsaoReceita.findMany({
    where: { orcamentoId: orcamento.id },
    include: { contaReceita: { select: { codigo: true, descricao: true } }, fonteRecurso: { select: { codigo: true, vinculada: true } } },
    take: 1000,
  })
  // Só de/para de regime de CAIXA (não competência) — evita o controle de baixa
  // (que exige crédito lançado antes) e dispara o patrimonial direto (E300/400/500).
  const caixaParams = paramsReceita.filter((p) => p.indicadorReconhecimento !== 'COMPETENCIA')
  const casaDePara = (cod: string) => caixaParams.some((p) => cod === p.naturezaCodigo || cod.startsWith(p.naturezaCodigo + '.'))
  const previsao = previsoes.find((p) => casaDePara(p.contaReceita.codigo)) ?? previsoes[0]
  if (!previsao) throw new Error('Nenhuma previsão no orçamento.')
  const temDePara = casaDePara(previsao.contaReceita.codigo)
  log(`Previsão: ${previsao.id}`)
  log(`  natureza: ${previsao.contaReceita.codigo}  | fonte: ${previsao.fonteRecurso.codigo} (vinculada=${previsao.fonteRecurso.vinculada})`)
  log(`  de/para casa? ${temDePara ? 'sim → dispara patrimonial' : 'não → só E100/E200'}\n`)

  if (!APLICAR) {
    log('DRY-RUN ok. Rode com --apply para arrecadar ao vivo e limpar.')
    return
  }

  const arrecadacoes = new ArrecadacoesService(prisma)
  const lancamentosSvc = new LancamentosService(prisma)
  const arrecadadoOriginal = new Prisma.Decimal(previsao.valorArrecadado)
  const criadas: string[] = []
  let ok = false
  try {
    log('── ARRECADAÇÃO ─────────────────────────────────────')
    const mov = await arrecadacoes.criar(orcamento.id, { previsaoId: previsao.id, tipo: 'ARRECADACAO', data: hoje(), valor: VALOR, historico: 'smoke', criadoPorId: SUFFIX } as never)
    criadas.push(mov.id)
    await mostrar(mov.id)

    log('── ESTORNO (inversão) ──────────────────────────────')
    const est = await arrecadacoes.criar(orcamento.id, { previsaoId: previsao.id, tipo: 'ESTORNO', data: hoje(), valor: ESTORNO, historico: 'smoke estorno', criadoPorId: SUFFIX } as never)
    criadas.push(est.id)
    await mostrar(est.id)

    log('\n✅ Arrecadação validada ao vivo. Limpando…')
    ok = true
  } finally {
    await cleanup(criadas, previsao.id, arrecadadoOriginal, lancamentosSvc)
    log(ok ? '✅ Cleanup concluído — previsão restaurada.' : '⚠️ Cleanup após falha — verifique.')
  }
}

async function mostrar(arrecadacaoId: string) {
  const lancs = await prisma.lancamento.findMany({
    where: { origemTipo: 'ARRECADACAO', origemId: arrecadacaoId },
    include: { itens: { include: { conta: { select: { codigo: true } } } } },
    orderBy: { eventoCodigo: 'asc' },
  })
  for (const l of lancs) {
    const somaD = l.itens.filter((i) => i.tipo === 'DEBITO').reduce((s, i) => s.plus(i.valor), new Prisma.Decimal(0))
    const somaC = l.itens.filter((i) => i.tipo === 'CREDITO').reduce((s, i) => s.plus(i.valor), new Prisma.Decimal(0))
    log(`  E${l.eventoCodigo}  ${l.historico}`)
    for (const i of l.itens) {
      const cc = i.naturezaReceitaCodigo ? 'nat' : i.fonteCodigo ? 'fonte' : '—'
      log(`      ${i.tipo === 'DEBITO' ? 'D' : 'C'} ${i.conta.codigo}  R$ ${money(i.valor)}  cc=${cc}`)
    }
    const balok = somaD.equals(somaC)
    log(`      ${balok ? '✓' : '✗'} balanço ΣD=ΣC (${money(somaD)}=${money(somaC)})`)
    if (!balok) throw new Error(`E${l.eventoCodigo} desbalanceado.`)
  }
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}
async function resolverModelo(entidadeId: string): Promise<string | null> {
  const e = await prisma.entidade.findUnique({ where: { id: entidadeId }, include: { municipio: { include: { estado: { select: { modeloContabilId: true } } } } } })
  return e?.municipio?.modeloContabilId ?? e?.municipio?.estado?.modeloContabilId ?? null
}
async function cleanup(arrecadacaoIds: string[], previsaoId: string, arrecadadoOriginal: Prisma.Decimal, lancamentosSvc: LancamentosService) {
  const lancs = await prisma.lancamento.findMany({ where: { origemTipo: 'ARRECADACAO', origemId: { in: arrecadacaoIds } }, select: { id: true } })
  for (const l of lancs) {
    try { await lancamentosSvc.excluir(l.id) } catch (e) { log(`  (cleanup) lançamento ${l.id}: ${(e as Error).message}`) }
  }
  if (arrecadacaoIds.length) await prisma.arrecadacao.deleteMany({ where: { id: { in: arrecadacaoIds } } })
  await prisma.previsaoReceita.update({ where: { id: previsaoId }, data: { valorArrecadado: arrecadadoOriginal } })
}

main().then(() => prisma.$disconnect().then(() => pool.end())).catch(async (e) => {
  console.error('\n❌ ERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect().catch(() => {})
  await pool.end().catch(() => {})
  process.exit(1)
})
