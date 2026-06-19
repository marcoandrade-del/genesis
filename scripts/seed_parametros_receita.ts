/**
 * Seed da parametrização da receita p/ a integração contábil (Tabela de Eventos):
 *   - ParametroReceita: de/para Natureza da Receita → conta de VPA (classe 4) +
 *     indicador de mutação (EFETIVA). Casamento por prefixo (nível configurado →
 *     folhas herdam). Esparso: só as naturezas não tributárias de teste.
 *   - EventoContabil 100/200/300: registro/visibilidade da matriz no modelo (o
 *     motor é code-driven; estes rows documentam os eventos no plano).
 *
 * Idempotente (upsert por chave única). Roda nos modelos PARANÁ e PCASP STN.
 *
 * Uso:
 *   npx tsx scripts/seed_parametros_receita.ts            # dry-run (não escreve)
 *   npx tsx scripts/seed_parametros_receita.ts --apply    # aplica
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type TipoMutacao, type IndicadorReconhecimento } from '@prisma/client'

const APLICAR = process.argv.includes('--apply')
const MODELOS = ['PARANÁ', 'PCASP STN']

// De/para NR → conta de contrapartida patrimonial. Configurado em nível de
// espécie/desdobramento; as folhas abaixo herdam por prefixo.
// CAIXA: reconhece na arrecadação (E300 VPA / E400 passivo / E500 baixa de ativo).
// COMPETENCIA (tributária): lançamento constitui o crédito (E550 D ativo / C VPA) e a
// arrecadação baixa o ativo (E560) — exige `ativo` (créditos a receber 1.1.2.x).
const PARAMETROS: Array<{
  natureza: string
  tipoMutacao: TipoMutacao
  contrapartida: string
  nome: string
  indicador?: IndicadorReconhecimento
  ativo?: string
  dividaAtiva?: string
}> = [
  // Efetivas — não tributárias (E300 — VPA, regime de caixa)
  { natureza: '1.3.1.1.01', tipoMutacao: 'EFETIVA', contrapartida: '4.3.3.1.1.02.00.00.00.00.00.00', nome: 'Aluguéis e arrendamentos → VPA exploração imobiliária' },
  { natureza: '1.3.2.1', tipoMutacao: 'EFETIVA', contrapartida: '4.4.5.2.1.00.00.00.00.00.00.00', nome: 'Rendimentos de aplicação → VPA financeira' },
  { natureza: '1.7.1.1.51', tipoMutacao: 'EFETIVA', contrapartida: '4.5.2.1.3.02.00.00.00.00.00.00', nome: 'Cota-Parte do FPM → VPA transferência' },
  // Não-efetivas (E400/E500 — passivo / baixa de ativo)
  { natureza: '2.1', tipoMutacao: 'NAO_EFETIVA', contrapartida: '2.2.2.1.1.02.98.00.00.00.00.00', nome: 'Operação de crédito (capital) → passivo empréstimo interno LP' },
  { natureza: '2.2', tipoMutacao: 'NAO_EFETIVA', contrapartida: '1.2.3.1.1.01.01.00.00.00.00.00', nome: 'Alienação de bens (capital) → baixa de imobilizado' },
  // Tributárias PRINCIPAL — competência (E550 lançamento D ativo / C VPA; E560 arrecadação
  // baixa o ativo; E570 inscrição em dívida ativa D dívida ativa / C baixa do circulante).
  { natureza: '1.1.1.2.50.0.1', tipoMutacao: 'EFETIVA', indicador: 'COMPETENCIA', contrapartida: '4.1.1.2.1.02.00.00.00.00.00.00', ativo: '1.1.2.1.1.01.05.00.00.00.00.00', dividaAtiva: '1.2.1.1.1.04.01.01.05.00.00.00', nome: 'IPTU Principal → VPA / ativo IPTU / dívida ativa IPTU' },
  { natureza: '1.1.1.4.51.1.1', tipoMutacao: 'EFETIVA', indicador: 'COMPETENCIA', contrapartida: '4.1.1.3.1.02.00.00.00.00.00.00', ativo: '1.1.2.1.1.01.07.00.00.00.00.00', dividaAtiva: '1.2.1.1.1.04.01.01.07.00.00.00', nome: 'ISSQN Principal → VPA / ativo ISS / dívida ativa ISS' },
  // Tributárias DÍVIDA ATIVA (…0.3 / …1.3) — arrecadação baixa o ativo de DÍVIDA ATIVA (E560).
  { natureza: '1.1.1.2.50.0.3', tipoMutacao: 'EFETIVA', indicador: 'COMPETENCIA', contrapartida: '4.1.1.2.1.02.00.00.00.00.00.00', ativo: '1.2.1.1.1.04.01.01.05.00.00.00', nome: 'IPTU Dívida Ativa → baixa do ativo de dívida ativa' },
  { natureza: '1.1.1.4.51.1.3', tipoMutacao: 'EFETIVA', indicador: 'COMPETENCIA', contrapartida: '4.1.1.3.1.02.00.00.00.00.00.00', ativo: '1.2.1.1.1.04.01.01.07.00.00.00', nome: 'ISSQN Dívida Ativa → baixa do ativo de dívida ativa' },
  // Multas e juros (…0.2 / …1.2) — receita efetiva (E300): D Caixa / C VPA de multas e juros.
  { natureza: '1.1.1.2.50.0.2', tipoMutacao: 'EFETIVA', contrapartida: '4.4.2.4.1.05.00.00.00.00.00.00', nome: 'IPTU Multas e Juros → VPA multas e juros sobre IPTU' },
  { natureza: '1.1.1.4.51.1.2', tipoMutacao: 'EFETIVA', contrapartida: '4.4.2.4.1.07.00.00.00.00.00.00', nome: 'ISSQN Multas e Juros → VPA multas e juros sobre ISS' },
]

const EVENTOS: Array<{ codigo: string; descricao: string }> = [
  { codigo: '100', descricao: 'Arrecadação orçamentária — D 6.2.1.2 Receita Realizada / C 6.2.1.1 Receita a Realizar (cc: natureza)' },
  { codigo: '200', descricao: 'Disponibilidade por Destinação (DDR) — D 7.2.1.1.x Controle / C 8.2.1.1.1.01 (cc: fonte)' },
  { codigo: '300', descricao: 'Variação Patrimonial Aumentativa (receita efetiva) — D 1.1.1.1.1.x Caixa / C VPA classe 4 (de/para NR→VPA)' },
  { codigo: '400', descricao: 'Mutação por operação de crédito (receita não-efetiva, capital 2.1) — D 1.1.1.1.1.x Caixa / C passivo classe 2' },
  { codigo: '500', descricao: 'Mutação por alienação de bens (receita não-efetiva, capital 2.2) — D 1.1.1.1.1.x Caixa / C baixa de ativo classe 1' },
  { codigo: '550', descricao: 'Lançamento de crédito tributário (competência) — D 1.1.2.x Créditos a Receber / C VPA classe 4' },
  { codigo: '560', descricao: 'Arrecadação da receita lançada — D 1.1.1.1.1.x Caixa / C 1.1.2.x baixa do crédito a receber (sem VPA nova)' },
  { codigo: '570', descricao: 'Inscrição em dívida ativa — D 1.2.1.x Dívida Ativa / C 1.1.2.x baixa do crédito a receber circulante (reclassificação)' },
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  console.log(`\n=== seed parametros receita (${APLICAR ? 'APPLY' : 'dry-run'}) ===`)
  for (const descricao of MODELOS) {
    const modelo = await prisma.modeloContabil.findUnique({ where: { descricao }, select: { id: true } })
    if (!modelo) {
      console.log(`\n[modelo "${descricao}"] não encontrado — pulando.`)
      continue
    }
    console.log(`\n[modelo "${descricao}" ${modelo.id}]`)

    for (const p of PARAMETROS) {
      if (APLICAR) {
        const campos = {
          tipoMutacao: p.tipoMutacao,
          contaContrapartidaCodigo: p.contrapartida,
          indicadorReconhecimento: p.indicador ?? ('CAIXA' as IndicadorReconhecimento),
          contaAtivoCodigo: p.ativo ?? null,
          contaDividaAtivaCodigo: p.dividaAtiva ?? null,
        }
        await prisma.parametroReceita.upsert({
          where: { modeloContabilId_naturezaCodigo: { modeloContabilId: modelo.id, naturezaCodigo: p.natureza } },
          create: { modeloContabilId: modelo.id, naturezaCodigo: p.natureza, ...campos },
          update: campos,
        })
      }
      const ind = p.indicador === 'COMPETENCIA' ? `COMPET. ativo ${p.ativo}` : p.tipoMutacao
      console.log(`  param  ${p.natureza.padEnd(16)} ${String(ind).padEnd(11)} → ${p.contrapartida}  (${p.nome})`)
    }

    for (const e of EVENTOS) {
      if (APLICAR) {
        await prisma.eventoContabil.upsert({
          where: { modeloContabilId_codigo: { modeloContabilId: modelo.id, codigo: e.codigo } },
          create: { modeloContabilId: modelo.id, codigo: e.codigo, descricao: e.descricao, tipoInscricao: '11 - Natureza da Receita' },
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
