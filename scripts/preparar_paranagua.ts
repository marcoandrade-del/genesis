/**
 * Prepara um usuário dedicado para navegar o /app SETADO no município de
 * Paranaguá (acesso-por-entidade): cria/atualiza `paranagua@dev.local` com senha
 * conhecida, permissões de menu completas e AcessoEntidade ADMIN APENAS nas
 * entidades de Paranaguá (assim o contexto do /app é Paranaguá). Não toca outros
 * usuários. Idempotente.
 *
 * Uso: npx tsx scripts/preparar_paranagua.ts [--apply]
 */
import 'dotenv/config'
import { hash } from 'argon2'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { semearMenusApp } from '../src/services/seed-menu-app.js'
import { SISTEMA_APP_NOME } from '../src/services/menu-app.js'

const APPLY = process.argv.includes('--apply')
const EMAIL = 'paranagua@dev.local'
const SENHA = 'Paranagua@2026'

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  // nome EXATO: existem DOIS Paranaguás no dev ("Paranaguá" IPM e "Paranaguá (SICONFI)");
  // contains pegaria um qualquer — o demo é do IPM
  const mun = await prisma.municipio.findFirstOrThrow({ where: { nome: 'Paranaguá' }, select: { id: true, nome: true } })
  const entidades = await prisma.entidade.findMany({ where: { municipioId: mun.id, ativo: true }, select: { id: true, nome: true } })
  console.log(`município: ${mun.nome} · entidades ativas: ${entidades.length}`)
  for (const e of entidades) console.log(`  - ${e.nome}`)

  if (!APPLY) {
    console.log(`\nDRY-RUN. --apply p/ criar ${EMAIL} (senha ${SENHA}) com acesso ADMIN só a essas ${entidades.length} entidades.`)
    await prisma.$disconnect()
    await pool.end()
    return
  }

  const senhaHash = await hash(SENHA)
  const dados = {
    nomeCompleto: 'Paranaguá (acesso demo)',
    nomeSocial: 'Paranaguá',
    dataNascimento: new Date('1990-01-01'),
    telefonePrincipal: '00000000000',
    senhaHash,
    ativo: true,
    emailValidado: true,
    celularValidado: true,
  }
  const usuario = await prisma.usuario.upsert({
    where: { emailPrincipal: EMAIL },
    create: { emailPrincipal: EMAIL, ...dados },
    update: dados,
    select: { id: true },
  })
  console.log(`usuário: ${EMAIL} (${usuario.id}) — senha redefinida.`)

  // menu do /app + permissão total
  const seed = await semearMenusApp(prisma)
  console.log(`[seed] itens novos no menu: ${seed.itens}`)
  const itens = await prisma.itemFuncionalidade.findMany({
    where: { menu: { modulo: { sistema: { nome: SISTEMA_APP_NOME } } } },
    select: { id: true },
  })
  for (const it of itens)
    await prisma.permissaoAcesso.upsert({
      where: { usuarioId_itemId: { usuarioId: usuario.id, itemId: it.id } },
      create: { usuarioId: usuario.id, itemId: it.id, nivel: 'EXCLUIR' },
      update: { nivel: 'EXCLUIR', ativo: true },
    })
  console.log(`[permissão] itens do /app com EXCLUIR: ${itens.length}`)

  // AcessoEntidade ADMIN só nas entidades de Paranaguá; desativa o resto
  const alvo = new Set(entidades.map((e) => e.id))
  for (const e of entidades)
    await prisma.acessoEntidade.upsert({
      where: { usuarioId_entidadeId: { usuarioId: usuario.id, entidadeId: e.id } },
      create: { usuarioId: usuario.id, entidadeId: e.id, nivel: 'ADMIN' },
      update: { nivel: 'ADMIN', ativo: true },
    })
  const outros = await prisma.acessoEntidade.updateMany({
    where: { usuarioId: usuario.id, entidadeId: { notIn: [...alvo] }, ativo: true },
    data: { ativo: false },
  })
  console.log(`[acesso] ADMIN em ${entidades.length} entidades de Paranaguá; desativados fora de Paranaguá: ${outros.count}`)
  console.log(`\n✅ pronto. Login: ${EMAIL} / ${SENHA} → contexto Paranaguá.`)
  await prisma.$disconnect()
  await pool.end()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
