/**
 * Seed da parametrização da DESPESA p/ a integração contábil (Tabela de Eventos):
 *   - ParametroDespesa: de/para Natureza da Despesa → VPD (classe 3) + passivo a
 *     pagar (2.1.x). Usado na LIQUIDAÇÃO (E702 patrimonial) e no PAGAMENTO (E802
 *     financeiro). Casamento por prefixo mais longo (nível configurado → folhas
 *     herdam). Esparso: sem de/para, o motor gera só orçamentário + DDR.
 *   - EventoContabil 6xx/7xx/8xx: registro/visibilidade da matriz da despesa no
 *     modelo (o motor é code-driven; estes rows documentam os eventos no plano).
 *
 * Idempotente (upsert por chave única). Roda nos modelos PARANÁ e PCASP STN.
 *
 * CUT-1 (custeio): pessoal (3.1.90.11) + material/serviços (3.3.90.30/36/39) com
 * VPD REPRESENTATIVA (folha "Outros…" do grupo — refinar por necessidade) e passivo
 * fornecedores. Capital (4.4.x→ativo) fica de fora (não é VPD). Para granular mais,
 * basta acrescentar linhas em PARAMETROS (o match é por prefixo mais longo).
 *
 * Uso:
 *   npx tsx scripts/seed_parametros_despesa.ts            # dry-run (não escreve)
 *   npx tsx scripts/seed_parametros_despesa.ts --apply    # aplica
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type CategoriaDespesa } from '@prisma/client'
import { CONTAS_DESPESA as C, TOKENS as T } from '../src/services/motor-eventos-despesa.js'
import { validarCategoriaDebito } from '../src/services/parametros-despesa.js'

const APLICAR = process.argv.includes('--apply')
const MODELOS = ['PARANÁ', 'PCASP STN']

// De/para Natureza da Despesa → conta a DEBITAR na liquidação (VPD / ativo /
// dívida, conforme a categoria) + conta a CREDITAR (passivo a pagar). Chave casada
// por prefixo mais longo: '3.1.90.11' cobre 3.1.90.11.xx.xx. Folhas confirmadas no
// PCASP (PARANÁ e PCASP STN). (repr.) = folha "Outros do grupo" representativa —
// refinar quando necessário. As linhas (repr.)/DEFERIDAS carecem de validação contábil.

// Contas a CREDITAR (passivo a pagar).
const FORNECEDORES = '2.1.3.1.1.01.01.00.00.00.00.00' // FORNECEDORES NÃO PARCELADOS A PAGAR
const SALARIOS = '2.1.1.1.1.01.01.00.00.00.00.00' // SALÁRIOS, REMUNERAÇÕES E BENEFÍCIOS
const ENCARGOS_PAGAR = '2.1.1.4.1.01.01.00.00.00.00.00' // CONTRIBUIÇÕES AO RGPS SOBRE SALÁRIOS
const DIVIDA_PAGAR = '2.1.2.1.1.02.01.00.00.00.00.00' // CONTRATOS DE EMPRÉSTIMOS INTERNOS (CP)

// Contas a DEBITAR por categoria.
const VPD_MATERIAL = '3.3.1.1.1.99.00.00.00.00.00.00' // OUTROS MATERIAIS DE CONSUMO
const VPD_SERV_PF = '3.3.2.2.1.99.00.00.00.00.00.00' // OUTROS SERVIÇOS - PF
const VPD_SERV_PJ = '3.3.2.3.1.99.00.00.00.00.00.00' // OUTROS SERVIÇOS - PJ
const VPD_VENCIMENTOS = '3.1.1.1.1.01.01.00.00.00.00.00' // VENCIMENTOS E SALÁRIOS
const VPD_ENCARGOS_RGPS = '3.1.2.2.1.01.00.00.00.00.00.00' // CONTRIBUIÇÕES PREVIDENCIÁRIAS - RGPS
const VPD_ENCARGOS_RPPS = '3.1.2.1.2.01.00.00.00.00.00.00' // CONTRIBUIÇÃO PATRONAL PARA O RPPS
const VPD_JUROS = '3.4.1.1.1.01.00.00.00.00.00.00' // JUROS DA DÍVIDA CONTRATUAL
const ATIVO_EQUIP = '1.2.3.1.1.01.06.00.00.00.00.00' // MÁQUINAS E EQUIPAMENTOS INDUSTRIAIS (repr.)
const ATIVO_IMOVEL = '1.2.3.2.1.01.03.00.00.00.00.00' // EDIFÍCIOS (repr.)
const DIVIDA_LP = '2.2.2.1.1.02.98.00.00.00.00.00' // OUTROS CONTRATOS - EMPRÉSTIMOS INTERNOS (LP)

const PARAMETROS: Array<{ natureza: string; categoria: CategoriaDespesa; vpd: string; passivo: string; nome: string }> = [
  // ── Pessoal (débito VPD 3.1) ──────────────────────────────────────────────
  { natureza: '3.1.90.11', categoria: 'PESSOAL', vpd: VPD_VENCIMENTOS, passivo: SALARIOS, nome: 'Vencimentos e Vantagens Fixas – Pessoal Civil' },
  { natureza: '3.1.90.16', categoria: 'PESSOAL', vpd: VPD_VENCIMENTOS, passivo: SALARIOS, nome: 'Outras Despesas Variáveis – Pessoal Civil (repr. VPD vencimentos)' },
  { natureza: '3.1.90.04', categoria: 'PESSOAL', vpd: VPD_VENCIMENTOS, passivo: SALARIOS, nome: 'Contratação por Tempo Determinado (repr. VPD vencimentos)' },
  { natureza: '3.1.90.13', categoria: 'PESSOAL', vpd: VPD_ENCARGOS_RGPS, passivo: ENCARGOS_PAGAR, nome: 'Contribuições Patronais → VPD encargos RGPS / encargos a pagar' },
  { natureza: '3.1.91.13', categoria: 'PESSOAL', vpd: VPD_ENCARGOS_RPPS, passivo: ENCARGOS_PAGAR, nome: 'Contribuições Patronais intra (RPPS) → VPD RPPS / encargos a pagar (validar intra)' },

  // ── Custeio (débito VPD 3.3) ──────────────────────────────────────────────
  { natureza: '3.3.90.30', categoria: 'CUSTEIO', vpd: VPD_MATERIAL, passivo: FORNECEDORES, nome: 'Material de Consumo (repr. VPD material)' },
  { natureza: '3.3.90.32', categoria: 'CUSTEIO', vpd: VPD_MATERIAL, passivo: FORNECEDORES, nome: 'Material p/ Distribuição Gratuita (repr. VPD material)' },
  { natureza: '3.3.90.36', categoria: 'CUSTEIO', vpd: VPD_SERV_PF, passivo: FORNECEDORES, nome: 'Serviços de Terceiros – PF (repr. VPD serviços PF)' },
  { natureza: '3.3.90.39', categoria: 'CUSTEIO', vpd: VPD_SERV_PJ, passivo: FORNECEDORES, nome: 'Serviços de Terceiros – PJ (repr. VPD serviços PJ)' },
  { natureza: '3.3.90.40', categoria: 'CUSTEIO', vpd: VPD_SERV_PJ, passivo: FORNECEDORES, nome: 'Serviços de TIC – PJ (repr. VPD serviços PJ)' },
  { natureza: '3.3.90.34', categoria: 'CUSTEIO', vpd: VPD_SERV_PJ, passivo: FORNECEDORES, nome: 'Terceirização (repr. VPD serviços PJ)' },
  { natureza: '3.3.90.46', categoria: 'CUSTEIO', vpd: VPD_SERV_PJ, passivo: FORNECEDORES, nome: 'Auxílio-Alimentação (repr. — validar: pode ser VPD benefício a pessoal)' },
  { natureza: '3.3.90.49', categoria: 'CUSTEIO', vpd: VPD_SERV_PJ, passivo: FORNECEDORES, nome: 'Auxílio-Transporte (repr. — validar: pode ser VPD benefício a pessoal)' },
  { natureza: '3.3.90.47', categoria: 'CUSTEIO', vpd: VPD_SERV_PJ, passivo: FORNECEDORES, nome: 'Obrigações Tributárias e Contributivas (repr. — validar: provável VPD tributária)' },

  // ── Capital (débito ATIVO 1.2.3) ──────────────────────────────────────────
  { natureza: '4.4.90.51', categoria: 'CAPITAL', vpd: ATIVO_IMOVEL, passivo: FORNECEDORES, nome: 'Obras e Instalações → ativo imóvel (repr. — validar: imóveis em andamento)' },
  { natureza: '4.4.90.52', categoria: 'CAPITAL', vpd: ATIVO_EQUIP, passivo: FORNECEDORES, nome: 'Equipamentos e Material Permanente → ativo bens móveis (repr.)' },
  { natureza: '4.4.90.61', categoria: 'CAPITAL', vpd: ATIVO_IMOVEL, passivo: FORNECEDORES, nome: 'Aquisição de Imóveis → ativo bens imóveis (repr.)' },

  // ── Juros (débito VPD financeira 3.4) ─────────────────────────────────────
  { natureza: '3.2.90.21', categoria: 'JUROS', vpd: VPD_JUROS, passivo: DIVIDA_PAGAR, nome: 'Juros sobre a Dívida por Contrato → VPD juros / dívida a pagar' },

  // ── Amortização (débito DÍVIDA 2.2) ───────────────────────────────────────
  { natureza: '4.6.90.71', categoria: 'AMORTIZACAO', vpd: DIVIDA_LP, passivo: DIVIDA_PAGAR, nome: 'Principal da Dívida Resgatado → reduz dívida LP / dívida a pagar (validar)' },
]

// Matriz da despesa: cada evento, seu GATILHO (estágio que o dispara) e as linhas
// D/C (códigos do PCASP ou tokens de de/para). É a "Tabela de Eventos" que o motor
// lê — editável no admin depois. O motor filtra por gatilho, não pelo código.
const EVENTOS: Array<{ codigo: string; gatilho: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO'; descricao: string; linhas: Array<[string, string]> }> = [
  { codigo: '600', gatilho: 'EMPENHO', descricao: 'Empenho — orçamentário', linhas: [[C.creditoDisponivel, C.empenhadoALiquidar]] },
  { codigo: '601', gatilho: 'EMPENHO', descricao: 'Empenho — controle DDR', linhas: [[C.ddrDisponivel, C.ddrComprEmpenho]] },
  { codigo: '700', gatilho: 'LIQUIDACAO', descricao: 'Liquidação — orçamentário', linhas: [[C.empenhadoALiquidar, C.liquidadoAPagar]] },
  { codigo: '701', gatilho: 'LIQUIDACAO', descricao: 'Liquidação — controle DDR', linhas: [[C.ddrComprEmpenho, C.ddrComprLiquidacao]] },
  { codigo: '702', gatilho: 'LIQUIDACAO', descricao: 'Liquidação — patrimonial (VPD / passivo)', linhas: [[T.VPD, T.PASSIVO]] },
  { codigo: '800', gatilho: 'PAGAMENTO', descricao: 'Pagamento — orçamentário', linhas: [[C.liquidadoAPagar, C.pago]] },
  { codigo: '801', gatilho: 'PAGAMENTO', descricao: 'Pagamento — controle DDR', linhas: [[C.ddrComprLiquidacao, C.ddrUtilizada]] },
  { codigo: '802', gatilho: 'PAGAMENTO', descricao: 'Pagamento — financeiro (passivo / caixa)', linhas: [[T.PASSIVO, T.CAIXA]] },
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  console.log(`\n=== seed parametros despesa (${APLICAR ? 'APPLY' : 'dry-run'}) ===`)

  // Barreira de sanidade: a classe da conta a DEBITAR tem de bater com a categoria.
  const invalidos = PARAMETROS.map((p) => validarCategoriaDebito(p.categoria, p.vpd)).filter((e): e is string => !!e)
  if (invalidos.length) {
    console.error('\n✗ de/para inconsistente (classe × categoria):\n  ' + invalidos.join('\n  '))
    await pool.end()
    process.exit(1)
  }

  for (const descricao of MODELOS) {
    const modelo = await prisma.modeloContabil.findUnique({ where: { descricao }, select: { id: true } })
    if (!modelo) {
      console.log(`\n[modelo "${descricao}"] não encontrado — pulando.`)
      continue
    }
    console.log(`\n[modelo "${descricao}" ${modelo.id}]`)

    for (const p of PARAMETROS) {
      if (APLICAR) {
        const campos = { contaVpdCodigo: p.vpd, contaPassivoCodigo: p.passivo, categoria: p.categoria }
        await prisma.parametroDespesa.upsert({
          where: { modeloContabilId_naturezaCodigo: { modeloContabilId: modelo.id, naturezaCodigo: p.natureza } },
          create: { modeloContabilId: modelo.id, naturezaCodigo: p.natureza, ...campos },
          update: campos,
        })
      }
      console.log(`  param  ${p.natureza.padEnd(12)} ${p.categoria.padEnd(11)} D ${p.vpd} / C ${p.passivo}  (${p.nome})`)
    }

    for (const e of EVENTOS) {
      if (APLICAR) {
        const ev = await prisma.eventoContabil.upsert({
          where: { modeloContabilId_codigo: { modeloContabilId: modelo.id, codigo: e.codigo } },
          create: { modeloContabilId: modelo.id, codigo: e.codigo, gatilho: e.gatilho, descricao: e.descricao, tipoInscricao: '11 - Natureza da Despesa' },
          update: { descricao: e.descricao, gatilho: e.gatilho },
        })
        // Substitui as linhas D/C integralmente (idempotente).
        await prisma.eventoLancamento.deleteMany({ where: { eventoId: ev.id } })
        await prisma.eventoLancamento.createMany({
          data: e.linhas.map(([debito, credito], i) => ({ eventoId: ev.id, ordem: i + 1, contaDebitoMascara: debito, contaCreditoMascara: credito })),
        })
      }
      const pernas = e.linhas.map(([d, c]) => `D ${d} / C ${c}`).join(' ; ')
      console.log(`  evento ${e.codigo}  ${e.descricao.padEnd(38)} [${pernas}]`)
    }
  }

  if (!APLICAR) console.log('\n(dry-run — nada foi escrito. Rode com --apply para persistir.)')
  else console.log('\n✓ aplicado.')
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
