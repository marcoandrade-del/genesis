import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/**
 * Semeia o estoque da Dívida Consolidada de Maringá 2026 (RGF Anexo 2) com o
 * saldo apurado no painel do TCE-PR (R$ 544,32mi, posição ~jun/2026). O TCE
 * publica só o total — entra como item único DEMAIS até termos a composição
 * (mobiliária/contratual/precatórios). Idempotente: não duplica.
 */
const DESCRICAO = 'Dívida Consolidada apurada — painel TCE-PR (saldo ~jun/2026; composição a detalhar)'
const VALOR = 544_320_000.0

async function main() {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const entidade = await prisma.entidade.findFirst({
    where: { nome: { contains: 'Prefeitura' }, municipio: { nome: 'Maringá' } },
    select: { id: true, nome: true },
  })
  if (!entidade) throw new Error('Entidade Prefeitura de Maringá não encontrada.')

  const existente = await prisma.dividaItem.findFirst({ where: { entidadeId: entidade.id, ano: 2026, descricao: DESCRICAO } })
  if (existente) {
    console.log(`Já semeado (${existente.id}) — nada a fazer.`)
  } else {
    const item = await prisma.dividaItem.create({
      data: { entidadeId: entidade.id, ano: 2026, categoria: 'DEMAIS', descricao: DESCRICAO, valorSaldo: VALOR },
    })
    console.log(`✅ DC semeada p/ ${entidade.nome}: R$ ${VALOR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${item.id})`)
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
