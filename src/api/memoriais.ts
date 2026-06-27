import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { MemorialRclService } from '../services/memorial-rcl.js'

/**
 * CONTRATO de dados dos memoriais (LRF) — versionado em SemVer.
 *
 * Regra que os DOIS projetos honram (Gênesis = produtor, Oxy = consumidor):
 *  - MAJOR muda ⇒ quebra de contrato (campo removido/renomeado/semântica
 *    alterada). O Oxy compara o MAJOR; se diferente do que suporta, NÃO renderiza
 *    dado possivelmente errado — mostra "conector desatualizado". Sem erro de versão.
 *  - MINOR muda ⇒ adição compatível (campo novo). O Oxy continua funcionando.
 *  - PATCH ⇒ correção sem mudança de forma.
 *
 * Ao mudar o cálculo/forma aqui, BUMP a versão abaixo (e o Oxy detecta).
 * Ver [[oxy-dashboards-integracao]].
 */
export const CONTRATO_MEMORIAIS = { nome: 'memoriais-lrf', versao: '1.0.0' } as const

/** Descritor do contrato: o que o Oxy pode validar antes de consumir. */
export function descreverContrato() {
  return {
    ...CONTRATO_MEMORIAIS,
    recursos: [
      { recurso: 'rcl', campos: ['entidade', 'ano', 'metodologia', 'temOrcamento', 'correntes', 'correntesTotal', 'deducoes', 'deducoesTotal', 'rcl'] },
      { recurso: 'rcl-consolidada', campos: ['municipio', 'estado', 'ano', 'metodologia', 'entidades', 'correntesTotal', 'deducoesTotal', 'intra', 'rclTotal'] },
    ],
  }
}

const envelope = (recurso: string, dados: unknown) => ({
  contrato: { nome: CONTRATO_MEMORIAIS.nome, versao: CONTRATO_MEMORIAIS.versao, recurso },
  dados,
})

/**
 * Data API read-only dos memoriais para o Oxy Dashboards. Token de SERVIÇO
 * (GENESIS_API_TOKEN). O Gênesis CALCULA; o Oxy só EXIBE — resultado pronto
 * (inputs + demonstrativo + total) e versionado pra não dar erro de versão.
 */
export async function memoriaisApiRoutes(app: FastifyInstance) {
  const svc = new MemorialRclService(app.prisma)

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = process.env.GENESIS_API_TOKEN
    if (!token) return reply.code(503).send({ erro: 'API de memoriais não configurada (defina GENESIS_API_TOKEN).' })
    if (req.headers.authorization !== `Bearer ${token}`) return reply.code(401).send({ erro: 'Não autorizado.' })
  })

  // O Oxy chama isto ANTES de consumir, pra checar compatibilidade de versão.
  app.get('/memoriais/contrato', async (_req, reply) => reply.send(descreverContrato()))

  function params(req: FastifyRequest<{ Querystring: { entidadeId?: string; ano?: string } }>) {
    const entidadeId = req.query.entidadeId
    const ano = parseInt(String(req.query.ano ?? ''), 10)
    return entidadeId && Number.isFinite(ano) ? { entidadeId, ano } : null
  }

  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/rcl', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const r = await svc.rcl(p.entidadeId, p.ano)
    if (!r) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send(envelope('rcl', r))
  })

  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/rcl-consolidada', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const r = await svc.rclConsolidada(p.entidadeId, p.ano)
    if (!r) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send(envelope('rcl-consolidada', r))
  })
}
