/**
 * Seed do fixture de e2e (drag-drop.spec.ts) — idempotente.
 *
 * Cria, com UUIDs FIXOS (os mesmos hardcoded no spec), o mínimo para que
 * `/admin/menus` renderize e a auth do admin passe:
 *   - Usuário admin ativo + vínculo AdminSistema ativo
 *   - Sistema → Módulo → Menu → 2 itens-irmãos (A e B) na raiz do menu
 *
 * Uso (aponte DATABASE_URL para o banco de teste):
 *   DATABASE_URL=... npx tsx e2e/seed.ts
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

const USER = '6ead2e8e-fea6-452e-82ca-70fe04e03af8'
const SISTEMA = 'b0000000-0000-4000-8000-000000000001'
const MODULO = 'b61787b9-6926-4c43-adb7-97c13984c7f3'
const ADMIN = 'b0000000-0000-4000-8000-000000000002'
const MENU = '4e569d95-cd48-4371-b6a1-c3b6e3d5e3e3'
const ITEM_A = '3d15d9ed-6c32-40c3-ab14-544d680e644b'
const ITEM_B = '2ea74c45-5955-4c2c-9482-11e62fdbddd8'

async function main() {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL não definida.')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  try {
    await prisma.usuario.upsert({
      where: { id: USER },
      update: { ativo: true, emailValidado: true, celularValidado: true },
      create: {
        id: USER,
        nomeCompleto: 'Marco Andrade (e2e)',
        nomeSocial: 'Marco',
        dataNascimento: new Date('1965-01-01'),
        emailPrincipal: 'marco.andrade@elotech.com.br',
        telefonePrincipal: '+5544999999999',
        emailValidado: true,
        celularValidado: true,
        ativo: true,
      },
    })

    await prisma.sistema.upsert({
      where: { id: SISTEMA },
      update: {},
      create: { id: SISTEMA, nome: 'Sistema E2E', ativo: true },
    })

    await prisma.adminSistema.upsert({
      where: { id: ADMIN },
      update: { ativo: true },
      create: { id: ADMIN, usuarioId: USER, sistemaId: SISTEMA, ativo: true },
    })

    await prisma.modulo.upsert({
      where: { id: MODULO },
      update: {},
      create: { id: MODULO, nome: 'Módulo E2E', sistemaId: SISTEMA, ordem: 0 },
    })

    await prisma.menu.upsert({
      where: { id: MENU },
      update: { moduloId: MODULO },
      create: { id: MENU, nome: 'Relatórios da Arrecadação dos Tributos', moduloId: MODULO, ordem: 0 },
    })

    for (const [id, nome] of [
      [ITEM_A, 'Demonstrativo analítico de pagamentos por empresa'],
      [ITEM_B, 'Demonstrativo analítico e sintético de pagamentos'],
    ] as const) {
      await prisma.itemFuncionalidade.upsert({
        where: { id },
        // Reafirma posição de irmão na raiz do menu (reverte qualquer drift).
        update: { menuId: MENU, parentId: null, ordem: 0 },
        create: { id, nome, tipo: 'FUNCIONALIDADE', menuId: MENU, parentId: null, ordem: 0 },
      })
    }

    console.log('[e2e seed] fixture pronto: usuário admin + menu com 2 itens-irmãos.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('[e2e seed] erro:', e)
  process.exit(1)
})
