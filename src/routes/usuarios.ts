import type { FastifyInstance } from 'fastify'
import { UsuariosService } from '../services/usuarios.js'
import { erroHttp, tratarErro } from '../errors.js'
import { sAtualizarUsuario } from '../schemas.js'

// Todas as rotas aqui exigem autenticação (registradas no escopo protegido)

export async function usuariosRoutes(app: FastifyInstance) {
  const service = new UsuariosService(app.prisma)

  app.get('/usuarios', async () => {
    const data = await service.listar()
    return { data }
  })

  app.get<{ Params: { id: string } }>('/usuarios/:id', async (req, reply) => {
    const usuario = await service.buscarPorId(req.params.id)
    if (!usuario) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.'))
    return { data: usuario }
  })

  app.put<{
    Params: { id: string }
    Body: {
      nomeCompleto?: string
      nomeSocial?: string
      dataNascimento?: string
      emailAlternativo?: string
      telefoneAlternativo?: string
    }
  }>('/usuarios/:id', { schema: sAtualizarUsuario }, async (req, reply) => {
    if (req.params.id !== req.user.sub) {
      return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode editar sua própria conta.'))
    }
    const usuario = await service.buscarPorId(req.params.id)
    if (!usuario) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.'))
    try {
      const atualizado = await service.atualizar(req.params.id, req.body)
      return { data: atualizado }
    } catch (e) {
      return tratarErro(e, reply)
    }
  })

  app.delete<{ Params: { id: string } }>('/usuarios/:id', async (req, reply) => {
    if (req.params.id !== req.user.sub) {
      return reply.status(403).send(erroHttp('NAO_AUTORIZADO', 'Você só pode excluir sua própria conta.'))
    }
    const usuario = await service.buscarPorId(req.params.id)
    if (!usuario) return reply.status(404).send(erroHttp('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.'))
    try {
      await service.excluir(req.params.id)
      return reply.status(204).send()
    } catch (e) {
      return tratarErro(e, reply)
    }
  })
}
