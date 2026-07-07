import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/**
 * Atualiza o cadastro da Dívida Consolidada de Maringá 2026 para a POSIÇÃO
 * COMPOSTA de 30/04/2026 do RGF Anexo 2 oficial do 1º quadrimestre
 * (data/abertura-2026/, idArquivo 2898579): Σ 544.316.158,21 — bate com o
 * painel do TCE. Substitui o item único provisório ("composição a detalhar").
 * Idempotente: só age se os itens novos ainda não existem.
 */
const MARCA = '(RGF A2 1ºQ/2026, posição 30/04/2026)'
const ITENS = [
  { categoria: 'CONTRATUAL' as const, descricao: `Empréstimos ${MARCA}`, valorSaldo: 341_450_763.85 },
  { categoria: 'CONTRATUAL' as const, descricao: `Reestruturação da dívida de Estados e Municípios ${MARCA}`, valorSaldo: 129_955_629.1 },
  { categoria: 'CONTRATUAL' as const, descricao: `Parcelamento e renegociação de dívidas ${MARCA}`, valorSaldo: 20_309_133.15 },
  { categoria: 'PRECATORIOS' as const, descricao: `Precatórios posteriores a 05/05/2000 — vencidos e não pagos ${MARCA}`, valorSaldo: 52_600_632.11 },
]

async function main() {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const entidade = await prisma.entidade.findFirst({
    where: { nome: { contains: 'Prefeitura' }, municipio: { nome: 'Maringá' } },
    select: { id: true },
  })
  if (!entidade) throw new Error('Prefeitura de Maringá não encontrada')

  const jaTem = await prisma.dividaItem.findFirst({ where: { entidadeId: entidade.id, ano: 2026, descricao: { contains: MARCA } } })
  if (jaTem) {
    console.log('Composição 30/04/2026 já cadastrada — nada a fazer.')
  } else {
    const provisorio = await prisma.dividaItem.deleteMany({
      where: { entidadeId: entidade.id, ano: 2026, descricao: { contains: 'composição a detalhar' } },
    })
    for (const item of ITENS) await prisma.dividaItem.create({ data: { entidadeId: entidade.id, ano: 2026, ...item } })
    const total = ITENS.reduce((a, i) => a + i.valorSaldo, 0)
    console.log(`✅ item provisório removido (${provisorio.count}); ${ITENS.length} itens criados — Σ R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
