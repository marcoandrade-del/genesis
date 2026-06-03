import type { FastifyInstance } from 'fastify'

/**
 * Área "Plano de Contas" (contábil) do operador. Lista o plano da entidade no
 * exercício corrente — escopo vem de `req.contexto` (entidade + ano), sem
 * picker. Read-only, ordenado por código e indentado por nível.
 */
export async function appContasRoutes(app: FastifyInstance) {
  app.get('/contas', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) {
      return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    }

    const contas = await app.prisma.contaContabilEntidade.findMany({
      where: { entidadeId, ano },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true },
    })

    return reply.view('app/contas', { entidade, ano, nivel, contas, layout: null })
  })
}
