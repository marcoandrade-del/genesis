import type { FastifyInstance } from 'fastify'
import { EstadosService } from '../services/estados.js'
import { RessincronizadorModelo, descreverResumo } from '../services/ressincronizador-modelo.js'

export async function adminEstadosRoutes(app: FastifyInstance) {
  const service = new EstadosService(app.prisma)

  app.get('/', async (req, reply) => {
    const [estados, municipiosComEntidade] = await Promise.all([
      app.prisma.estado.findMany({
        orderBy: { nome: 'asc' },
        include: {
          modeloContabil: { select: { id: true, descricao: true } },
          _count: { select: { municipios: true } },
        },
      }),
      // Estados que têm ≥1 entidade ativa com plano contábil copiado (via seus municípios).
      app.prisma.municipio.findMany({
        where: { entidades: { some: { ativo: true, contasContabil: { some: {} } } } },
        select: { estadoId: true },
      }),
    ])
    const estadosComEntidade = [...new Set(municipiosComEntidade.map((m) => m.estadoId))]
    return reply.view(
      'estados/index',
      { title: 'Estados — Gênesis Admin', active: 'estados', userEmail: req.user.email, estados, estadosComEntidade },
      { layout: 'layouts/main' },
    )
  })

  // Estados não suportam create/delete via UI (27 UFs vêm do seed).
  // Só PUT do modeloContabilId.
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const estado = await app.prisma.estado.findUnique({
      where: { id: req.params.id },
      include: {
        modeloContabil: { select: { id: true, descricao: true } },
        _count: { select: { municipios: true } },
      },
    })
    if (!estado) return reply.status(404).send('Estado não encontrado.')

    // Lista todos os modelos ativos para o select; ordena alfabeticamente.
    const modelos = await app.prisma.modeloContabil.findMany({
      where: { ativo: true },
      orderBy: { descricao: 'asc' },
      select: { id: true, descricao: true },
    })

    return reply.view('estados/form', { estado, modelos, erro: null })
  })

  app.put<{ Params: { id: string }; Body: { modeloContabilId?: string } }>(
    '/:id',
    async (req, reply) => {
      // String vazia = limpar; senão usa o valor recebido.
      const novoId = req.body.modeloContabilId?.trim() ? req.body.modeloContabilId : null
      try {
        const r = await service.definirModelo(req.params.id, novoId)
        // Sinaliza ao admin quantos municípios foram tocados pela propagação.
        return reply
          .header('HX-Redirect', '/admin/estados')
          .header(
            'HX-Trigger',
            JSON.stringify({ mostrarInfo: { titulo: 'Modelo atualizado', texto: `${r.municipiosAtualizados} município(s) recebido(s) o novo modelo.` } }),
          )
          .status(204)
          .send()
      } catch (e: unknown) {
        const estado = await app.prisma.estado.findUnique({
          where: { id: req.params.id },
          include: { modeloContabil: true, _count: { select: { municipios: true } } },
        })
        const modelos = await app.prisma.modeloContabil.findMany({
          where: { ativo: true },
          orderBy: { descricao: 'asc' },
          select: { id: true, descricao: true },
        })
        const msg = e instanceof Error ? e.message : 'Erro ao atualizar modelo contábil do estado.'
        return reply.view('estados/form', { estado, modelos, erro: msg })
      }
    },
  )

  // Ressincroniza TODAS as entidades dos municípios deste estado com o modelo
  // atual (recopia o plano-MODELO; desdobramentos/execução são preservados).
  app.post<{ Params: { id: string } }>('/:id/ressincronizar', async (req, reply) => {
    try {
      const resumo = await new RessincronizadorModelo(app.prisma).ressincronizarEstado(req.params.id)
      return reply
        .header('HX-Trigger', JSON.stringify({ mostrarInfo: { titulo: 'Ressincronização concluída', texto: descreverResumo(resumo) } }))
        .status(204)
        .send()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao ressincronizar entidades.'
      return reply.status(400).send(msg)
    }
  })
}
