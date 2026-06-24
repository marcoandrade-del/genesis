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
import { PrismaClient } from '@prisma/client'
import { CONTAS_DESPESA as C, TOKENS as T } from '../src/services/motor-eventos-despesa.js'

const APLICAR = process.argv.includes('--apply')
const MODELOS = ['PARANÁ', 'PCASP STN']

// De/para Natureza da Despesa → VPD (classe 3) + passivo a pagar (2.1.x).
// Chave casada por prefixo mais longo: '3.1.90.11' cobre 3.1.90.11.xx.xx.
const FORNECEDORES = '2.1.3.1.1.01.01.00.00.00.00.00' // FORNECEDORES NÃO PARCELADOS A PAGAR
const PARAMETROS: Array<{ natureza: string; vpd: string; passivo: string; nome: string }> = [
  {
    natureza: '3.1.90.11',
    vpd: '3.1.1.1.1.01.01.00.00.00.00.00', // VENCIMENTOS E SALÁRIOS
    passivo: '2.1.1.1.1.01.01.00.00.00.00.00', // SALÁRIOS, REMUNERAÇÕES E BENEFÍCIOS
    nome: 'Vencimentos e Vantagens Fixas – Pessoal Civil → VPD pessoal / passivo salários a pagar',
  },
  {
    natureza: '3.3.90.30',
    vpd: '3.3.1.1.1.99.00.00.00.00.00.00', // OUTROS MATERIAIS DE CONSUMO (representativa)
    passivo: FORNECEDORES,
    nome: 'Material de Consumo → VPD uso de material (repr.) / passivo fornecedores',
  },
  {
    natureza: '3.3.90.36',
    vpd: '3.3.2.2.1.99.00.00.00.00.00.00', // OUTROS SERVIÇOS PRESTADOS POR PESSOA FÍSICA (repr.)
    passivo: FORNECEDORES,
    nome: 'Serviços de Terceiros – Pessoa Física → VPD serviços PF (repr.) / passivo fornecedores',
  },
  {
    natureza: '3.3.90.39',
    vpd: '3.3.2.3.1.99.00.00.00.00.00.00', // OUTROS SERVIÇOS TERCEIROS - PJ (representativa)
    passivo: FORNECEDORES,
    nome: 'Serviços de Terceiros – Pessoa Jurídica → VPD serviços PJ (repr.) / passivo fornecedores',
  },
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
  for (const descricao of MODELOS) {
    const modelo = await prisma.modeloContabil.findUnique({ where: { descricao }, select: { id: true } })
    if (!modelo) {
      console.log(`\n[modelo "${descricao}"] não encontrado — pulando.`)
      continue
    }
    console.log(`\n[modelo "${descricao}" ${modelo.id}]`)

    for (const p of PARAMETROS) {
      if (APLICAR) {
        const campos = { contaVpdCodigo: p.vpd, contaPassivoCodigo: p.passivo }
        await prisma.parametroDespesa.upsert({
          where: { modeloContabilId_naturezaCodigo: { modeloContabilId: modelo.id, naturezaCodigo: p.natureza } },
          create: { modeloContabilId: modelo.id, naturezaCodigo: p.natureza, ...campos },
          update: campos,
        })
      }
      console.log(`  param  ${p.natureza.padEnd(12)} VPD ${p.vpd} / passivo ${p.passivo}  (${p.nome})`)
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
