import type { FastifyInstance } from 'fastify'
import { LixeiraService } from '../services/lixeira.js'

export async function adminLixeiraRoutes(app: FastifyInstance) {
  const lixeiraSvc = new LixeiraService(app.prisma)

  app.get('/', async (req, reply) => {
    const itens = await lixeiraSvc.listar()
    return reply.view(
      'lixeira/index',
      { title: 'Lixeira — Gênesis Admin', active: 'lixeira', userEmail: req.user.email, itens },
      { layout: 'layouts/main' },
    )
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await lixeiraSvc.excluirPermanente(req.params.id)
      const itens = await lixeiraSvc.listar()
      return reply.view('lixeira/tabela', { itens })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir permanentemente.'
      return reply.status(400).send(msg)
    }
  })

  app.post<{ Params: { id: string } }>('/:id/restaurar', async (req, reply) => {
    try {
      await lixeiraSvc.restaurar(req.params.id)
      const itens = await lixeiraSvc.listar()
      return reply.view('lixeira/tabela', { itens })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao restaurar item.'
      return reply.status(400).send(msg)
    }
  })
}
