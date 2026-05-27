/**
 * Cria (ou re-ativa) um admin temporário para inspeção visual local.
 *
 *   showcase@dev.local / demo1234
 *
 * Idempotente — pode rodar várias vezes.
 *
 * Cleanup:
 *   npx tsx scripts/seed_admin_temp.ts --remove
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import 'dotenv/config'

const EMAIL = 'showcase@dev.local'
const SENHA = 'demo1234'
const SISTEMA_NOME = 'Showcase Dev'

async function main() {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL não definida.')
  const adapter = new PrismaPg({ connectionString: url })
  const prisma = new PrismaClient({ adapter })

  try {
    if (process.argv.includes('--remove')) {
      const u = await prisma.usuario.findUnique({ where: { emailPrincipal: EMAIL } })
      if (!u) { console.log('[seed-admin] usuário inexistente.'); return }
      await prisma.adminSistema.deleteMany({ where: { usuarioId: u.id } })
      await prisma.usuario.delete({ where: { id: u.id } })
      console.log('[seed-admin] removido.')
      return
    }

    // Sistema (idempotente por nome — não há unique no schema, então findFirst+create)
    let sistema = await prisma.sistema.findFirst({ where: { nome: SISTEMA_NOME } })
    if (!sistema) {
      sistema = await prisma.sistema.create({ data: { nome: SISTEMA_NOME, descricao: 'Sistema temporário para inspeção visual.' } })
    }

    const senhaHash = await argon2.hash(SENHA)
    const usuario = await prisma.usuario.upsert({
      where: { emailPrincipal: EMAIL },
      update: {
        senhaHash,
        emailValidado: true,
        celularValidado: true,
        ativo: true,
      },
      create: {
        emailPrincipal: EMAIL,
        nomeCompleto: 'Showcase Admin',
        nomeSocial: 'Showcase',
        dataNascimento: new Date('1990-01-01'),
        telefonePrincipal: '(44) 99999-9999',
        senhaHash,
        emailValidado: true,
        celularValidado: true,
        ativo: true,
      },
    })

    const vinculo = await prisma.adminSistema.findFirst({
      where: { usuarioId: usuario.id, sistemaId: sistema.id },
    })
    if (vinculo) {
      await prisma.adminSistema.update({ where: { id: vinculo.id }, data: { ativo: true } })
    } else {
      await prisma.adminSistema.create({
        data: { usuarioId: usuario.id, sistemaId: sistema.id, ativo: true },
      })
    }

    console.log(`[seed-admin] OK — login com ${EMAIL} / ${SENHA}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error('[seed-admin] erro:', e); process.exit(1) })
