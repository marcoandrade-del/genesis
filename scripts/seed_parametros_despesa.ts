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

const EVENTOS: Array<{ codigo: string; descricao: string }> = [
  { codigo: '600', descricao: 'Empenho — orçamentário: D 6.2.2.1.1 Crédito Disponível / C 6.2.2.1.3.01 Empenhado a Liquidar (cc: dotação)' },
  { codigo: '601', descricao: 'Empenho — controle DDR: D 8.2.1.1.1 Disponível / C 8.2.1.1.2 Compr. p/ Empenho (cc: dotação)' },
  { codigo: '700', descricao: 'Liquidação — orçamentário: D 6.2.2.1.3.01 Empenhado a Liquidar / C 6.2.2.1.3.03 Liquidado a Pagar (cc: dotação)' },
  { codigo: '701', descricao: 'Liquidação — controle DDR: D 8.2.1.1.2 Compr. Empenho / C 8.2.1.1.3 Compr. Liquidação (cc: dotação)' },
  { codigo: '702', descricao: 'Liquidação — patrimonial (fato gerador da VPD): D VPD classe 3 / C passivo 2.1.x (de/para natureza)' },
  { codigo: '800', descricao: 'Pagamento — orçamentário: D 6.2.2.1.3.03 Liquidado a Pagar / C 6.2.2.1.3.04 Pago (cc: dotação)' },
  { codigo: '801', descricao: 'Pagamento — controle DDR: D 8.2.1.1.3 Compr. Liquidação / C 8.2.1.1.4 Utilizada (cc: dotação)' },
  { codigo: '802', descricao: 'Pagamento — financeiro: D passivo 2.1.x / C 1.1.1.x Caixa/Banco (da conta bancária)' },
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
        await prisma.eventoContabil.upsert({
          where: { modeloContabilId_codigo: { modeloContabilId: modelo.id, codigo: e.codigo } },
          create: { modeloContabilId: modelo.id, codigo: e.codigo, descricao: e.descricao, tipoInscricao: '11 - Natureza da Despesa' },
          update: { descricao: e.descricao },
        })
      }
      console.log(`  evento ${e.codigo}  ${e.descricao}`)
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
