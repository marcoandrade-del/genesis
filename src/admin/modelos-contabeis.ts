import type { FastifyInstance } from 'fastify'
import { ModelosContabeisService } from '../services/modelos-contabeis.js'

export async function adminModelosContabeisRoutes(app: FastifyInstance) {
  const service = new ModelosContabeisService(app.prisma)

  app.get('/', async (req, reply) => {
    // _count traz quantos estados/municípios/planos usam o modelo — útil pra UI
    // mostrar "em uso" e advertir antes de excluir.
    const modelos = await app.prisma.modeloContabil.findMany({
      orderBy: { descricao: 'asc' },
      include: { _count: { select: { estados: true, municipios: true, planos: true } } },
    })
    return reply.view(
      'modelos-contabeis/index',
      { title: 'Modelos Contábeis — Gênesis Admin', active: 'modelos-contabeis', userEmail: req.user.email, modelos },
      { layout: 'layouts/main' },
    )
  })

  app.get('/form', async (_req, reply) => {
    return reply.view('modelos-contabeis/form', { modelo: null, erro: null })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const modelo = await service.buscarPorId(req.params.id)
    if (!modelo) return reply.status(404).send('Modelo contábil não encontrado.')
    return reply.view('modelos-contabeis/form', { modelo, erro: null })
  })

  app.post<{ Body: { descricao: string; ativo?: string } }>('/', async (req, reply) => {
    const { descricao, ativo } = req.body
    if (!descricao?.trim()) {
      return reply.view('modelos-contabeis/form', { modelo: null, erro: 'A descrição é obrigatória.' })
    }
    try {
      // Novo modelo nasce ativo por default — UI de criação nem mostra o toggle.
      await service.criar({ descricao: descricao.trim(), ativo: ativo !== 'false' })
      return reply.header('HX-Redirect', '/admin/modelos-contabeis').status(204).send()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar modelo contábil.'
      return reply.view('modelos-contabeis/form', { modelo: null, erro: msg })
    }
  })

  app.put<{ Params: { id: string }; Body: { descricao: string; ativo?: string } }>(
    '/:id',
    async (req, reply) => {
      const { descricao, ativo } = req.body
      if (!descricao?.trim()) {
        const modelo = await service.buscarPorId(req.params.id)
        return reply.view('modelos-contabeis/form', { modelo, erro: 'A descrição é obrigatória.' })
      }
      try {
        await service.atualizar(req.params.id, {
          descricao: descricao.trim(),
          ...(ativo !== undefined ? { ativo: ativo === 'true' } : {}),
        })
        return reply.header('HX-Redirect', '/admin/modelos-contabeis').status(204).send()
      } catch (e: unknown) {
        const modelo = await service.buscarPorId(req.params.id)
        const msg = e instanceof Error ? e.message : 'Erro ao atualizar modelo contábil.'
        return reply.view('modelos-contabeis/form', { modelo, erro: msg })
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir.'
      return reply.status(400).send(msg)
    }
  })
}
