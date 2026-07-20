/**
 * Onboarding de PARANAGUÁ/PR (2026) — Município + entidades + Orçamento vazio.
 *
 * Reusa EntidadeService.criar (copia o plano de contas do modelo PARANÁ + as
 * fontes TCE-PR estaduais para cada entidade). Idempotente: pode rodar de novo.
 * A LOA (previsão/dotação) e a execução (PIT) entram em passos seguintes.
 *
 * Rodar: npx tsx scripts/onboard_paranagua_2026.ts
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type TipoEntidade } from '@prisma/client'
import { EntidadeService } from '../src/services/entidades.js'

const ANO = 2026
const MUNICIPIO = 'Paranaguá'
const ENTIDADES: { nome: string; tipo: TipoEntidade }[] = [
  { nome: 'Prefeitura Municipal de Paranaguá', tipo: 'PREFEITURA' },
  { nome: 'Câmara Municipal de Paranaguá', tipo: 'CAMARA' },
  { nome: 'Paranaguá Previdência', tipo: 'ADM_INDIRETA' },
  // CAGEPAR: autarquia reguladora de água/esgoto (LC 181/2015). No PIT aparece como
  // "CENTRAL DE ÁGUA, ESGOTO E SERVIÇOS CONCEDIDOS DO LITORAL DO PARANÁ".
  { nome: 'CAGEPAR - Central de Água, Esgoto e Serviços Concedidos do Litoral do Paraná', tipo: 'ADM_INDIRETA' },
]

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const estado = await prisma.estado.findFirstOrThrow({ where: { sigla: 'PR' }, select: { id: true, modeloContabilId: true } })

  let municipio = await prisma.municipio.findFirst({ where: { nome: MUNICIPIO, estadoId: estado.id }, select: { id: true } })
  if (!municipio) {
    municipio = await prisma.municipio.create({ data: { nome: MUNICIPIO, estadoId: estado.id }, select: { id: true } })
    console.log(`✓ Município criado: ${MUNICIPIO}/PR (${municipio.id})`)
  } else {
    console.log(`• Município já existe: ${MUNICIPIO}/PR (${municipio.id})`)
  }

  const svc = new EntidadeService(prisma)
  for (const e of ENTIDADES) {
    let ent = await prisma.entidade.findFirst({ where: { nome: e.nome, municipioId: municipio.id }, select: { id: true } })
    if (!ent) {
      ent = await svc.criar({ municipioId: municipio.id, nome: e.nome, tipo: e.tipo, ano: ANO })
      console.log(`✓ Entidade criada: ${e.tipo} · ${e.nome} (${ent.id})`)
    } else {
      console.log(`• Entidade já existe: ${e.tipo} · ${e.nome} (${ent.id})`)
    }

    const orc = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId: ent.id, ano: ANO } }, select: { id: true, status: true } })
    if (!orc) {
      const novo = await prisma.orcamento.create({ data: { entidadeId: ent.id, ano: ANO, status: 'RASCUNHO' }, select: { id: true } })
      console.log(`  ✓ Orçamento ${ANO} criado (RASCUNHO, ${novo.id})`)
    } else {
      console.log(`  • Orçamento ${ANO} já existe (${orc.status})`)
    }

    const [nDesp, nRec, nCont, nFonte] = await Promise.all([
      prisma.contaDespesaEntidade.count({ where: { entidadeId: ent.id, ano: ANO } }),
      prisma.contaReceitaEntidade.count({ where: { entidadeId: ent.id, ano: ANO } }),
      prisma.contaContabilEntidade.count({ where: { entidadeId: ent.id, ano: ANO } }),
      prisma.fonteRecursoEntidade.count({ where: { entidadeId: ent.id, ano: ANO } }),
    ])
    console.log(`  plano provisionado: despesa=${nDesp} · receita=${nRec} · contábil=${nCont} · fontes=${nFonte}`)
  }
}

main().catch((e) => { console.error('ERRO:', (e as Error).message); process.exitCode = 1 }).finally(async () => {
  await prisma.$disconnect()
  await pool.end()
})
