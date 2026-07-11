import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SolicitacoesAcessoBiService } from '../services/solicitacoes-acesso-bi.js'
import { tratarErro } from '../errors.js'

/**
 * Contrato das AÇÕES do usuário do BI (OXY). Dado um e-mail, o usuário solicita/lista/cancela
 * acesso a um município (via SolicitacaoAcessoEntidade → PREFEITURA). Ver
 * `oxy-repo/INTEGRACAO-GENESIS.md`.
 */
export const CONTRATO_SOLICITACOES_ACESSO = { nome: 'solicitacoes-acesso', versao: '1.0.0' } as const

/**
 * Data API de ESCRITA do usuário do BI (OXY Dashboards), separada do `memoriais.ts`
 * (read-only) de propósito. Autenticada pelo token de SERVIÇO (GENESIS_API_TOKEN): o
 * oxy-bi-jpa é o BFF e a identidade do usuário vem no corpo/query como e-mail, não em JWT
 * de usuário. A APROVAÇÃO das solicitações segue no admin do Gênesis (aqui só o lado do usuário).
 */
export async function acoesUsuarioApiRoutes(app: FastifyInstance) {
  const svc = new SolicitacoesAcessoBiService(app.prisma)

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = process.env.GENESIS_API_TOKEN
    if (!token) return reply.code(503).send({ erro: 'API não configurada (defina GENESIS_API_TOKEN).' })
    if (req.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ erro: 'Não autorizado.' })
  })

  const envelope = (dados: unknown) => ({
    contrato: { ...CONTRATO_SOLICITACOES_ACESSO, recurso: 'solicitacoes-acesso' },
    dados,
  })

  // Usuário solicita acesso a um município.
  app.post<{ Body: { email?: string; municipioId?: string; justificativa?: string } }>(
    '/acoes/solicitacoes-acesso',
    async (req, reply) => {
      try {
        const { email, municipioId, justificativa } = req.body ?? {}
        if (!email?.trim() || !municipioId?.trim()) {
          return reply.code(400).send({ erro: 'email e municipioId são obrigatórios.' })
        }
        const dados = await svc.solicitar(email, municipioId, justificativa)
        return reply.code(201).send(envelope(dados))
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )

  // Solicitações do próprio usuário.
  app.get<{ Querystring: { email?: string } }>('/acoes/solicitacoes-acesso', async (req, reply) => {
    try {
      const email = (req.query.email ?? '').trim()
      if (!email) return reply.code(400).send({ erro: 'email é obrigatório.' })
      const dados = await svc.listar(email)
      return reply.send(envelope(dados))
    } catch (e) {
      return tratarErro(e, reply)
    }
  })

  // Usuário cancela a própria solicitação pendente.
  app.post<{ Params: { id: string }; Body: { email?: string } }>(
    '/acoes/solicitacoes-acesso/:id/cancelar',
    async (req, reply) => {
      try {
        const email = (req.body?.email ?? '').trim()
        if (!email) return reply.code(400).send({ erro: 'email é obrigatório.' })
        const dados = await svc.cancelar(email, req.params.id)
        return reply.send(envelope(dados))
      } catch (e) {
        return tratarErro(e, reply)
      }
    },
  )
}
