/**
 * Concede ACESSO TOTAL a um usuário (por e-mail):
 *  - AcessoEntidade nível ADMIN em TODAS as entidades ativas;
 *  - PermissaoAcesso nível EXCLUIR (máximo) em TODOS os itens do menu /app —
 *    inclusive os restritos (semGrant, ex.: bancada de memoriais);
 *  - roda o seed do menu antes (garante que os itens novos existam).
 * Idempotente. Rodar: npx tsx scripts/conceder_acesso_total.ts marco@teste.com
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { semearMenusApp } from '../src/services/seed-menu-app.js'
import { SISTEMA_APP_NOME } from '../src/services/menu-app.js'

const email = process.argv[2]
if (!email) {
  console.error('Uso: npx tsx scripts/conceder_acesso_total.ts <email>')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const usuario = await prisma.usuario.findFirst({ where: { emailPrincipal: email }, select: { id: true, nomeCompleto: true } })
  if (!usuario) throw new Error(`Usuário ${email} não encontrado.`)
  console.log(`Usuário: ${usuario.nomeCompleto ?? email} (${usuario.id})`)

  const seed = await semearMenusApp(prisma)
  console.log(`[seed] itens novos no menu: ${seed.itens} · grants VISUALIZAR novos: ${seed.grants}`)

  // AcessoEntidade ADMIN em todas as entidades ativas
  const entidades = await prisma.entidade.findMany({ where: { ativo: true }, select: { id: true, nome: true } })
  let acessos = 0
  for (const e of entidades) {
    const atual = await prisma.acessoEntidade.findUnique({
      where: { usuarioId_entidadeId: { usuarioId: usuario.id, entidadeId: e.id } },
    })
    if (atual) {
      if (atual.nivel !== 'ADMIN' || !atual.ativo) {
        await prisma.acessoEntidade.update({ where: { id: atual.id }, data: { nivel: 'ADMIN', ativo: true } })
        acessos++
      }
    } else {
      await prisma.acessoEntidade.create({ data: { usuarioId: usuario.id, entidadeId: e.id, nivel: 'ADMIN' } })
      acessos++
    }
  }
  console.log(`[acesso] entidades com ADMIN garantido: ${entidades.length} (alterados/criados: ${acessos})`)

  // PermissaoAcesso EXCLUIR em TODOS os itens do menu /app (inclui semGrant)
  const itens = await prisma.itemFuncionalidade.findMany({
    where: { menu: { modulo: { sistema: { nome: SISTEMA_APP_NOME } } } },
    select: { id: true },
  })
  let permissoes = 0
  for (const it of itens) {
    const atual = await prisma.permissaoAcesso.findUnique({
      where: { usuarioId_itemId: { usuarioId: usuario.id, itemId: it.id } },
    })
    if (atual) {
      if (atual.nivel !== 'EXCLUIR' || !atual.ativo) {
        await prisma.permissaoAcesso.update({ where: { id: atual.id }, data: { nivel: 'EXCLUIR', ativo: true } })
        permissoes++
      }
    } else {
      await prisma.permissaoAcesso.create({ data: { usuarioId: usuario.id, itemId: it.id, nivel: 'EXCLUIR' } })
      permissoes++
    }
  }
  console.log(`[permissão] itens do /app com EXCLUIR: ${itens.length} (alterados/criados: ${permissoes})`)
  console.log('✅ acesso total concedido.')
}
main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
