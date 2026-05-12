import type { FastifyInstance } from 'fastify'
import type { Prisma } from '@prisma/client'
import { UsuariosService } from '../services/usuarios.js'
import { CodigosService } from '../services/codigos.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

export async function adminUsuariosRoutes(app: FastifyInstance) {
  const service = new UsuariosService(app.prisma)
  const codigos = new CodigosService(app.prisma)

  app.get<{ Querystring: { busca?: string; status?: string } }>('/', async (req, reply) => {
    const { busca = '', status = '' } = req.query

    const where: Prisma.UsuarioWhereInput = {
      AND: [
        busca
          ? {
              OR: [
                { nomeCompleto: { contains: busca, mode: 'insensitive' } },
                { emailPrincipal: { contains: busca, mode: 'insensitive' } },
              ],
            }
          : {},
        status === 'ativo'
          ? { ativo: true }
          : status === 'inativo'
            ? { ativo: false, emailValidado: false }
            : status === 'pendente'
              ? { ativo: false, OR: [{ emailValidado: true }, { celularValidado: true }] }
              : {},
      ],
    }

    const [usuarios, total] = await Promise.all([
      app.prisma.usuario.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        take: 100,
        include: { _count: { select: { adminSistemas: true } } },
      }),
      app.prisma.usuario.count({ where }),
    ])

    return reply.view(
      'usuarios/index',
      {
        title: 'Usuários — Gênesis Admin',
        active: 'usuarios',
        userEmail: req.user.email,
        usuarios,
        total,
        busca,
        status,
      },
      { layout: 'layouts/main' },
    )
  })

  app.get('/lista', async (req, reply) => {
    const [usuarios, total] = await Promise.all([
      app.prisma.usuario.findMany({
        orderBy: { criadoEm: 'desc' },
        take: 100,
        include: { _count: { select: { adminSistemas: true } } },
      }),
      app.prisma.usuario.count(),
    ])
    return reply.view('usuarios/lista', { usuarios, total })
  })

  app.get('/form', async (req, reply) => {
    return reply.view('usuarios/form', { usuario: null, erro: null })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const usuario = await service.buscarPorId(req.params.id)
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    return reply.view('usuarios/form', { usuario, erro: null })
  })

  app.post<{ Body: Record<string, string> }>('/', async (req, reply) => {
    const b = req.body
    try {
      await service.criar({
        nomeCompleto: b['nomeCompleto'] ?? '',
        nomeSocial: b['nomeSocial'] ?? '',
        dataNascimento: b['dataNascimento'] ?? '',
        emailPrincipal: b['emailPrincipal'] ?? '',
        telefonePrincipal: b['telefonePrincipal'] ?? '',
        senha: b['senha'] ?? '',
        ativo: b['ativo'] === 'true',
        ...(b['cpf'] ? { cpf: b['cpf'] } : {}),
        ...(b['idEstrangeiro'] ? { idEstrangeiro: b['idEstrangeiro'] } : {}),
        ...(b['emailAlternativo'] ? { emailAlternativo: b['emailAlternativo'] } : {}),
        ...(b['telefoneAlternativo'] ? { telefoneAlternativo: b['telefoneAlternativo'] } : {}),
      })
      return reply.header('HX-Trigger', '{"usuarioSalvo": null}').status(204).send()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar usuário.'
      return reply.view('usuarios/form', { usuario: null, erro: msg })
    }
  })

  app.put<{ Params: { id: string }; Body: Record<string, string> }>('/:id', async (req, reply) => {
    const b = req.body
    const usuario = await service.buscarPorId(req.params.id)
    if (!usuario) return reply.view('usuarios/form', { usuario: null, erro: 'Usuário não encontrado.' })
    try {
      await service.atualizar(req.params.id, {
        ...(b['nomeCompleto'] ? { nomeCompleto: b['nomeCompleto'] } : {}),
        ...(b['nomeSocial'] !== undefined ? { nomeSocial: b['nomeSocial'] } : {}),
        ...(b['dataNascimento'] ? { dataNascimento: b['dataNascimento'] } : {}),
        ...(b['telefonePrincipal'] ? { telefonePrincipal: b['telefonePrincipal'] } : {}),
        ativo: b['ativo'] === 'true',
        ...(b['emailAlternativo'] ? { emailAlternativo: b['emailAlternativo'] } : {}),
        ...(b['telefoneAlternativo'] ? { telefoneAlternativo: b['telefoneAlternativo'] } : {}),
        ...(b['senha'] ? { senha: b['senha'] } : {}),
      })
      return reply.header('HX-Trigger', '{"usuarioSalvo": null}').status(204).send()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar usuário.'
      return reply.view('usuarios/form', { usuario, erro: msg })
    }
  })

  // Dispara envio de código de validação. NUNCA marca emailValidado/celularValidado
  // manualmente — só o fluxo de validação por código (rota /admin/ativar) altera o estado.
  app.post<{ Params: { id: string } }>('/:id/enviar-codigo-email', async (req, reply) => {
    try {
      await codigos.solicitar(req.params.id, 'EMAIL')
      const trigger = JSON.stringify({ mostrarInfo: { titulo: 'E-mail enviado', texto: 'Um e-mail com link e código de verificação foi enviado ao usuário.' } })
      return reply.header('HX-Trigger', trigger).status(204).send()
    } catch (e) {
      if (e instanceof ErroNegocio) return reply.status(statusDeErro(e.code)).send(e.message)
      return reply.status(500).send('Erro ao enviar e-mail de validação.')
    }
  })

  app.post<{ Params: { id: string } }>('/:id/enviar-codigo-celular', async (req, reply) => {
    try {
      await codigos.solicitar(req.params.id, 'CELULAR')
      const trigger = JSON.stringify({ mostrarInfo: { titulo: 'SMS enviado', texto: 'Um SMS com código de verificação foi enviado ao usuário.' } })
      return reply.header('HX-Trigger', trigger).status(204).send()
    } catch (e) {
      if (e instanceof ErroNegocio) return reply.status(statusDeErro(e.code)).send(e.message)
      return reply.status(500).send('Erro ao enviar SMS de validação.')
    }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return reply.status(statusDeErro(e.code)).send(e.message)
      }
      return reply.status(500).send('Erro ao excluir usuário.')
    }
  })
}
