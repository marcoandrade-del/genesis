/**
 * Smoke AO VIVO do disparo contábil da execução da despesa (Motor Fase 3).
 *
 * Roda a cadeia empenho → liquidação → pagamento (+ estorno) numa dotação real,
 * confere os lançamentos gerados pela Tabela de Eventos (E6xx/E7xx/E8xx), valida
 * partida dobrada (ΣD=ΣC) e conta-corrente=dotação, e **limpa tudo ao final**
 * (try/finally) — restaurando os contadores da dotação e removendo os artefatos.
 *
 * Fixtures temporárias (conta bancária da fonte; de/para patrimonial) são criadas
 * só se faltarem e removidas no cleanup. Valores de teste minúsculos (R$ 1,00).
 *
 * Rodar:
 *   npx tsx scripts/smoke_despesa_eventos.ts            # DRY-RUN: só recon + verifica plano
 *   npx tsx scripts/smoke_despesa_eventos.ts --apply    # roda a cadeia e limpa
 */

import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { EmpenhosService } from '../src/services/empenhos.js'
import { LiquidacoesService } from '../src/services/liquidacoes.js'
import { OrdensPagamentoService } from '../src/services/ordens-pagamento.js'
import { LancamentosService } from '../src/services/lancamentos.js'
import { CONTAS_DESPESA } from '../src/services/motor-eventos-despesa.js'

const APPLY = process.argv.includes('--apply')
const VALOR = '1.00'
const ESTORNO = '0.30'
const SUFFIX = `SMOKE-${Date.now()}`

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const log = (s = '') => console.log(s)
const money = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v).toFixed(2)

async function main() {
  log(`Smoke disparo despesa — modo: ${APPLY ? 'APPLY (cria e limpa)' : 'DRY-RUN (só recon)'}\n`)

  // 1) Entidade com orçamento executável + plano contábil da despesa completo.
  const orcamento = await prisma.orcamento.findFirst({
    where: { status: { in: ['EM_EXECUCAO', 'APROVADO'] } },
    orderBy: { ano: 'desc' },
    include: { entidade: { select: { id: true, nome: true } } },
  })
  if (!orcamento) throw new Error('Nenhum orçamento EM_EXECUCAO/APROVADO encontrado.')
  const entidadeId = orcamento.entidadeId
  const ano = orcamento.ano
  log(`Entidade: ${orcamento.entidade.nome} (${entidadeId})`)
  log(`Orçamento: ${ano} — ${orcamento.status}\n`)

  // Plano contábil: as folhas orçamentário+DDR precisam existir e admitir movimento.
  // (`caixaPagamento` é só fallback; o caixa real do E802 vem da conta bancária.)
  const { caixaPagamento, ...folhasObrig } = CONTAS_DESPESA
  void caixaPagamento
  const folhas = await prisma.contaContabilEntidade.findMany({
    where: { entidadeId, ano, codigo: { in: Object.values(folhasObrig) }, admiteMovimento: true },
    select: { codigo: true },
  })
  const presentes = new Set(folhas.map((f) => f.codigo))
  const faltando = Object.values(folhasObrig).filter((c) => !presentes.has(c))
  log('Folhas orçamentário + DDR no plano:')
  for (const [nome, codigo] of Object.entries(folhasObrig)) {
    log(`  ${presentes.has(codigo) ? '✓' : '✗'} ${nome.padEnd(20)} ${codigo}`)
  }
  if (faltando.length) throw new Error(`Plano incompleto — faltam folhas: ${faltando.join(', ')}`)
  // Caixa real (folha analítica 1.1.1.x) p/ a conta bancária do pagamento.
  const caixaFolha = await prisma.contaContabilEntidade.findFirst({
    where: { entidadeId, ano, admiteMovimento: true, codigo: { startsWith: '1.1.1.1' } },
    orderBy: { codigo: 'asc' }, select: { codigo: true },
  })
  if (!caixaFolha) throw new Error('Nenhuma folha de caixa (1.1.1.x) no plano — sem como pagar.')
  log(`Caixa (folha real p/ E802): ${caixaFolha.codigo}\n`)

  // 2) Dotação com saldo + sub-elemento folha sob o elemento + fonte.
  //    Prefere CUSTEIO (natureza 3.x — o "cut 1" do motor) à despesa de capital (4.x).
  const candidatas = await prisma.dotacaoDespesa.findMany({
    where: { orcamentoId: orcamento.id },
    include: { contaDespesa: { select: { codigo: true } }, fonteRecurso: { select: { codigo: true } }, orcamento: { select: { ano: true } } },
    take: 500,
  })
  candidatas.sort((a, b) => Number(b.contaDespesa.codigo.startsWith('3')) - Number(a.contaDespesa.codigo.startsWith('3')))
  let escolha: { dotacao: (typeof candidatas)[number]; sub: { id: string; codigo: string } } | null = null
  for (const d of candidatas) {
    const disp = new Prisma.Decimal(d.valorAutorizado).minus(d.valorReservado).minus(d.valorEmpenhado)
    if (disp.lessThan(VALOR)) continue
    const elementoPrefixo = d.contaDespesa.codigo.split('.').slice(0, 4).join('.') + '.'
    const sub = await prisma.contaDespesaEntidade.findFirst({
      where: { entidadeId, ano, admiteMovimento: true, codigo: { startsWith: elementoPrefixo } },
      orderBy: { codigo: 'desc' }, // prefere o sub-elemento mais detalhado
      select: { id: true, codigo: true },
    })
    if (sub) { escolha = { dotacao: d, sub }; break }
  }
  if (!escolha) throw new Error('Nenhuma dotação com saldo + sub-elemento folha encontrada.')
  const { dotacao, sub } = escolha
  const disp = new Prisma.Decimal(dotacao.valorAutorizado).minus(dotacao.valorReservado).minus(dotacao.valorEmpenhado)
  log(`Dotação: ${dotacao.id}`)
  log(`  natureza (elemento): ${dotacao.contaDespesa.codigo}  | fonte: ${dotacao.fonteRecurso.codigo}`)
  log(`  sub-elemento (empenho): ${sub.codigo}`)
  log(`  disponível: R$ ${money(disp)}  (empenhado atual: ${money(dotacao.valorEmpenhado)})\n`)

  // 3) Fornecedor: usa um ativo existente, ou cria temporário (limpa depois).
  const fornecedorExistente = await prisma.fornecedor.findFirst({ where: { ativo: true }, select: { id: true, razaoSocial: true } })
  log(fornecedorExistente ? `Fornecedor: ${fornecedorExistente.razaoSocial} (${fornecedorExistente.id})` : 'Fornecedor: nenhum ativo → criarei temporário')

  // 4) Conta bancária da fonte: o smoke cria uma TEMPORÁRIA com o caixa real (folha
  //    1.1.1.x) — não reusa contas existentes (podem ter contaContabilCodigo nulo).
  log(`Conta bancária: criarei temporária (fonte ${dotacao.fonteRecurso.codigo}, caixa ${caixaFolha.codigo})`)

  // 5) De/para patrimonial (opcional): habilita E702/E802 se houver VPD (classe 3) e passivo (2.1.x).
  const vpd = await prisma.contaContabilEntidade.findFirst({ where: { entidadeId, ano, admiteMovimento: true, codigo: { startsWith: '3.' } }, orderBy: { codigo: 'asc' }, select: { codigo: true } })
  const passivo = await prisma.contaContabilEntidade.findFirst({ where: { entidadeId, ano, admiteMovimento: true, codigo: { startsWith: '2.1.' } }, orderBy: { codigo: 'asc' }, select: { codigo: true } })
  const modeloId = await resolverModelo(entidadeId)
  const naturezaDeParaPrefix = dotacao.contaDespesa.codigo.split('.').slice(0, 4).join('.') // ex.: 3.3.90.30
  const podeDePara = !!(vpd && passivo && modeloId)
  log(podeDePara ? `De/para patrimonial: VPD ${vpd!.codigo} / passivo ${passivo!.codigo} (natureza ${naturezaDeParaPrefix})` : 'De/para patrimonial: indisponível (sem VPD/passivo folha ou sem modelo) → valida só orçamentário+DDR')
  log('')

  if (!APPLY) {
    log('DRY-RUN ok. Tudo que o smoke precisa existe. Rode com --apply para executar a cadeia ao vivo.')
    return
  }

  // ----------------------------- APPLY -----------------------------
  const empenhos = new EmpenhosService(prisma)
  const liquidacoes = new LiquidacoesService(prisma)
  const ordens = new OrdensPagamentoService(prisma)
  const lancamentosSvc = new LancamentosService(prisma)

  // Captura para restaurar no cleanup.
  const empenhadoOriginal = new Prisma.Decimal(dotacao.valorEmpenhado)
  const reservadoOriginal = new Prisma.Decimal(dotacao.valorReservado)
  const criados: { empenhoId?: string; liquidacaoId?: string; opId?: string; deParaId?: string; contaTempId?: string; fornecedorTempId?: string } = {}
  let ok = false

  try {
    let fornecedorId = fornecedorExistente?.id
    if (!fornecedorId) {
      const f = await prisma.fornecedor.create({
        data: { tipoPessoa: 'PJ', cnpj: `00000000${SUFFIX.slice(-6)}`.slice(-14), razaoSocial: `Smoke ${SUFFIX}`, ativo: true },
        select: { id: true },
      })
      fornecedorId = f.id
      criados.fornecedorTempId = f.id
    }

    if (podeDePara) {
      const dp = await prisma.parametroDespesa.create({
        data: { modeloContabilId: modeloId!, naturezaCodigo: naturezaDeParaPrefix, contaVpdCodigo: vpd!.codigo, contaPassivoCodigo: passivo!.codigo },
      })
      criados.deParaId = dp.id
    }
    const conta = await prisma.contaBancaria.create({
      data: {
        entidadeId, fonteCodigo: dotacao.fonteRecurso.codigo, ativa: true,
        bancoCodigo: '001', agencia: '0001', numero: SUFFIX.slice(-8), descricao: `Smoke ${SUFFIX}`,
        contaContabilCodigo: caixaFolha.codigo, // caixa real do E802
      },
      select: { id: true },
    })
    criados.contaTempId = conta.id

    const usuarioId = `${SUFFIX}`

    // EMPENHO
    log('── EMPENHO ─────────────────────────────────────────')
    const emp = await empenhos.criar(entidadeId, {
      dotacaoDespesaId: dotacao.id, fornecedorId, subElementoContaId: sub.id,
      numero: `${SUFFIX}-NE`, tipo: 'ORDINARIO', valor: VALOR, historico: 'smoke',
    } as never, usuarioId)
    criados.empenhoId = emp.id
    await mostrarLancamentos('EMPENHO', emp.id)

    // LIQUIDAÇÃO
    log('── LIQUIDAÇÃO ──────────────────────────────────────')
    const liq = await liquidacoes.criar(entidadeId, { empenhoId: emp.id, numero: `${SUFFIX}-LIQ`, valor: VALOR, notaFiscal: 'smoke' } as never, usuarioId)
    criados.liquidacaoId = liq.id
    await mostrarLancamentos('LIQUIDACAO', liq.id)

    // PAGAMENTO
    log('── PAGAMENTO ───────────────────────────────────────')
    const op = await ordens.criar(entidadeId, { liquidacaoId: liq.id, numero: `${SUFFIX}-OP`, valor: VALOR, contaBancariaId: conta.id } as never, usuarioId)
    criados.opId = op.id
    await mostrarLancamentos('PAGAMENTO', op.id)

    // ESTORNO DO PAGAMENTO (inversão D↔C)
    log('── ESTORNO DO PAGAMENTO (inversão) ─────────────────')
    await ordens.estornar(op.id, ESTORNO, usuarioId, new Date())
    await mostrarLancamentos('PAGAMENTO', op.id, true)

    // FICHA: trilha contábil reúne todo o ciclo (empenho + liquidação + pagamento + estorno).
    log('── FICHA — trilha contábil (Fase 5) ────────────────')
    const ficha = await empenhos.ficha(emp.id)
    log(`  trilha: ${ficha.trilha.length} lançamento(s) — eventos [${ficha.trilha.map((l) => 'E' + l.eventoCodigo).join(', ')}]`)

    log('\n✅ Cadeia executada e validada ao vivo. Limpando os artefatos…')
    ok = true
  } finally {
    await cleanup(criados, dotacao.id, empenhadoOriginal, reservadoOriginal, lancamentosSvc)
    log(ok ? '✅ Cleanup concluído — LOA/contadores restaurados.' : '⚠️ Cleanup executado após falha — verifique o estado.')
  }
}

/** Imprime os lançamentos contábeis gerados por um movimento e valida ΣD=ΣC + cc=dotação. */
async function mostrarLancamentos(origemTipo: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO', origemId: string, soUltimos = false) {
  const lancs = await prisma.lancamento.findMany({
    where: { origemTipo, origemId },
    include: { itens: { include: { conta: { select: { codigo: true } } } } },
    orderBy: { criadoEm: 'asc' },
  })
  const mostrar = soUltimos ? lancs.slice(-3) : lancs // no estorno do pagamento, os últimos eventos são a inversão
  for (const l of mostrar) {
    const somaD = l.itens.filter((i) => i.tipo === 'DEBITO').reduce((s, i) => s.plus(i.valor), new Prisma.Decimal(0))
    const somaC = l.itens.filter((i) => i.tipo === 'CREDITO').reduce((s, i) => s.plus(i.valor), new Prisma.Decimal(0))
    const balok = somaD.equals(somaC)
    const ccok = l.itens.every((i) => i.dotacaoDespesaId)
    log(`  E${l.eventoCodigo}  ${l.historico}`)
    for (const i of l.itens) {
      log(`      ${i.tipo === 'DEBITO' ? 'D' : 'C'} ${i.conta.codigo}  R$ ${money(i.valor)}  cc=${i.dotacaoDespesaId ? 'dotação' : '—'}`)
    }
    log(`      ${balok ? '✓' : '✗'} balanço ΣD=ΣC (${money(somaD)}=${money(somaC)})  ${ccok ? '✓' : '✗'} cc=dotação`)
    if (!balok || !ccok) throw new Error(`Lançamento E${l.eventoCodigo} inválido (balanço/cc).`)
  }
}

async function resolverModelo(entidadeId: string): Promise<string | null> {
  const e = await prisma.entidade.findUnique({
    where: { id: entidadeId },
    include: { municipio: { include: { estado: { select: { modeloContabilId: true } } } } },
  })
  return e?.municipio?.modeloContabilId ?? e?.municipio?.estado?.modeloContabilId ?? null
}

async function cleanup(
  criados: { empenhoId?: string; liquidacaoId?: string; opId?: string; deParaId?: string; contaTempId?: string; fornecedorTempId?: string },
  dotacaoId: string,
  empenhadoOriginal: Prisma.Decimal,
  reservadoOriginal: Prisma.Decimal,
  lancamentosSvc: LancamentosService,
) {
  // Apaga os lançamentos contábeis (reverte ResumoMensalConta) por origem.
  const origemIds = [criados.empenhoId, criados.liquidacaoId, criados.opId].filter(Boolean) as string[]
  const lancs = await prisma.lancamento.findMany({ where: { origemId: { in: origemIds }, origemTipo: { in: ['EMPENHO', 'LIQUIDACAO', 'PAGAMENTO'] } }, select: { id: true } })
  for (const l of lancs) {
    try { await lancamentosSvc.excluir(l.id) } catch (e) { log(`  (cleanup) falha ao excluir lançamento ${l.id}: ${(e as Error).message}`) }
  }
  // Razão imutável + linhas da execução.
  if (criados.empenhoId) await prisma.movimentoEmpenho.deleteMany({ where: { empenhoId: criados.empenhoId } })
  if (criados.opId) await prisma.ordemPagamento.deleteMany({ where: { id: criados.opId } })
  if (criados.liquidacaoId) await prisma.liquidacao.deleteMany({ where: { id: criados.liquidacaoId } })
  if (criados.empenhoId) await prisma.empenho.deleteMany({ where: { id: criados.empenhoId } })
  // Restaura os contadores materializados da dotação.
  await prisma.dotacaoDespesa.update({ where: { id: dotacaoId }, data: { valorEmpenhado: empenhadoOriginal, valorReservado: reservadoOriginal } })
  // Fixtures temporárias.
  if (criados.deParaId) await prisma.parametroDespesa.deleteMany({ where: { id: criados.deParaId } })
  if (criados.contaTempId) await prisma.contaBancaria.deleteMany({ where: { id: criados.contaTempId } })
  if (criados.fornecedorTempId) await prisma.fornecedor.deleteMany({ where: { id: criados.fornecedorTempId } })
}

main()
  .then(() => prisma.$disconnect().then(() => pool.end()))
  .catch(async (e) => {
    console.error('\n❌ ERRO:', e instanceof Error ? e.message : e)
    await prisma.$disconnect().catch(() => {})
    await pool.end().catch(() => {})
    process.exit(1)
  })
