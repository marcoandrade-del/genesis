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
import { PrismaClient, type TipoMutacao } from '@prisma/client'

const APLICAR = process.argv.includes('--apply')
const MODELOS = ['PARANÁ', 'PCASP STN']

// De/para NR → VPA (classe 4). Naturezas não tributárias EFETIVAS presentes na
// LOA de Maringá (exceto aluguel, canônico). Configurado em nível de espécie/
// desdobramento; as folhas abaixo herdam por prefixo.
const PARAMETROS: Array<{ natureza: string; tipoMutacao: TipoMutacao; vpa: string; nome: string }> = [
  { natureza: '1.3.1.1.01', tipoMutacao: 'EFETIVA', vpa: '4.3.3.1.1.02.00.00.00.00.00.00', nome: 'Aluguéis e arrendamentos (patrimônio imobiliário)' },
  { natureza: '1.3.2.1', tipoMutacao: 'EFETIVA', vpa: '4.4.5.2.1.00.00.00.00.00.00.00', nome: 'Rendimentos de aplicação financeira' },
  { natureza: '1.7.1.1.51', tipoMutacao: 'EFETIVA', vpa: '4.5.2.1.3.02.00.00.00.00.00.00', nome: 'Cota-Parte do FPM (transferência intergovernamental)' },
]

const EVENTOS: Array<{ codigo: string; descricao: string }> = [
  { codigo: '100', descricao: 'Arrecadação orçamentária — D 6.2.1.2 Receita Realizada / C 6.2.1.1 Receita a Realizar (cc: natureza)' },
  { codigo: '200', descricao: 'Disponibilidade por Destinação (DDR) — D 7.2.1.1.x Controle / C 8.2.1.1.1.01 (cc: fonte)' },
  { codigo: '300', descricao: 'Variação Patrimonial Aumentativa (receita efetiva) — D 1.1.1.1.1.x Caixa / C VPA classe 4 (de/para NR→VPA)' },
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
        await prisma.parametroReceita.upsert({
          where: { modeloContabilId_naturezaCodigo: { modeloContabilId: modelo.id, naturezaCodigo: p.natureza } },
          create: { modeloContabilId: modelo.id, naturezaCodigo: p.natureza, tipoMutacao: p.tipoMutacao, contaVpaCodigo: p.vpa },
          update: { tipoMutacao: p.tipoMutacao, contaVpaCodigo: p.vpa },
        })
      }
      console.log(`  param  ${p.natureza.padEnd(12)} ${p.tipoMutacao}  → VPA ${p.vpa}  (${p.nome})`)
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
