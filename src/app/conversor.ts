import type { FastifyInstance } from 'fastify'
import { calcularSelo } from '../conversor/selo.js'

/**
 * Painel de Conversão (Selo de Conversão) — a visibilidade sobre o que foi
 * convertido do município (todas as entidades), o que confere e o que falta.
 * O escopo é o MUNICÍPIO da entidade do contexto atual.
 */
export async function appConversorRoutes(app: FastifyInstance) {
  app.get('/conversor', async (req, reply) => {
    const { entidadeId, ano } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true } } } } },
    })
    if (!entidade) {
      reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      return
    }
    const selo = await calcularSelo(app.prisma, entidade.municipio.nome, ano)
    return reply.view('app/conversor', { entidade, ano, selo, layout: null })
  })
}
