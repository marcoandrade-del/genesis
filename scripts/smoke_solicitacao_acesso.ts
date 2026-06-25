/**
 * Smoke AO VIVO do fluxo de solicitação de acesso a entidades (PR-1) contra o
 * banco real. Escolhe uma entidade ativa e um usuário SEM acesso/pendência a
 * ela, cria a solicitação, aprova (decidindo o nível) e confere que o
 * AcessoEntidade nasceu ativo no nível concedido. **Limpa tudo no final**
 * (try/finally) — o banco volta ao estado original.
 *
 *   npx tsx scripts/smoke_solicitacao_acesso.ts            # DRY-RUN (recon)
 *   npx tsx scripts/smoke_solicitacao_acesso.ts --apply    # roda e limpa
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { SolicitacoesAcessoService } from '../src/services/solicitacoes-acesso.js'

const APLICAR = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const log = (s = '') => console.log(s)

async function main() {
  log(`Smoke solicitação de acesso — ${APLICAR ? 'APPLY (roda e limpa)' : 'DRY-RUN (recon)'}\n`)
  const svc = new SolicitacoesAcessoService(prisma)

  const entidade = await prisma.entidade.findFirst({
    where: { ativo: true },
    include: { municipio: { include: { estado: true } } },
    orderBy: { nome: 'asc' },
  })
  if (!entidade) throw new Error('Nenhuma entidade ativa no banco.')

  // Usuário sem acesso e sem pendência para esta entidade.
  const usuarios = await prisma.usuario.findMany({ select: { id: true, nomeCompleto: true }, take: 50 })
  let usuario: { id: string; nomeCompleto: string } | undefined
  for (const u of usuarios) {
    const [acesso, pend] = await Promise.all([
      prisma.acessoEntidade.findUnique({
        where: { usuarioId_entidadeId: { usuarioId: u.id, entidadeId: entidade.id } },
      }),
      prisma.solicitacaoAcessoEntidade.findFirst({
        where: { usuarioId: u.id, entidadeId: entidade.id, status: 'PENDENTE' },
      }),
    ])
    if (!acesso && !pend) { usuario = u; break }
  }
  if (!usuario) throw new Error('Nenhum usuário sem acesso/pendência para a entidade escolhida.')

  log(`Entidade: ${entidade.nome} (${entidade.municipio.estado.sigla} · ${entidade.municipio.nome})`)
  log(`Usuário:  ${usuario.nomeCompleto} [${usuario.id}]`)
  log(`Plano: criar PENDENTE (LEITURA) → aprovar concedendo ESCRITA → conferir acesso → limpar\n`)

  if (!APLICAR) {
    log('DRY-RUN: nada gravado. Use --apply para executar.')
    return
  }

  let solicitacaoId: string | null = null
  try {
    const sol = await svc.criar({
      usuarioId: usuario.id,
      entidadeId: entidade.id,
      nivelSolicitado: 'LEITURA',
      justificativa: 'smoke test',
    })
    solicitacaoId = sol.id
    log(`✔ solicitação criada: ${sol.id} (status ${sol.status}, pediu ${sol.nivelSolicitado})`)

    const pendentes = await svc.listarPendentes()
    const aparece = pendentes.some((p) => p.id === sol.id)
    log(`✔ aparece na fila de pendentes: ${aparece}`)
    if (!aparece) throw new Error('Solicitação não apareceu na fila de pendentes.')

    await svc.aprovar(sol.id, usuario.id, 'ESCRITA', 'aprovado no smoke')
    log('✔ aprovada concedendo ESCRITA')

    const acesso = await prisma.acessoEntidade.findUnique({
      where: { usuarioId_entidadeId: { usuarioId: usuario.id, entidadeId: entidade.id } },
    })
    const decidida = await prisma.solicitacaoAcessoEntidade.findUnique({ where: { id: sol.id } })
    log(`✔ AcessoEntidade: ${acesso ? `${acesso.nivel} ativo=${acesso.ativo}` : 'NÃO CRIADO'}`)
    log(`✔ solicitação: status=${decidida?.status} nívelConcedido=${decidida?.nivelConcedido}`)

    const ok =
      acesso?.nivel === 'ESCRITA' &&
      acesso.ativo === true &&
      decidida?.status === 'APROVADA' &&
      decidida.nivelConcedido === 'ESCRITA'
    log(`\n${ok ? '✅ FLUXO OK' : '❌ FLUXO INCONSISTENTE'}`)
    if (!ok) throw new Error('Resultado inconsistente.')
  } finally {
    // Limpeza: remove o acesso e a solicitação criados.
    await prisma.acessoEntidade.deleteMany({ where: { usuarioId: usuario.id, entidadeId: entidade.id } })
    if (solicitacaoId) await prisma.solicitacaoAcessoEntidade.delete({ where: { id: solicitacaoId } })
    log('\n🧹 limpeza concluída (acesso + solicitação removidos).')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
