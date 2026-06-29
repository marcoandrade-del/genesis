import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { MemorialRclService } from '../services/memorial-rcl.js'
import { MemorialGuardiaoService } from '../services/memorial-guardiao.js'
import { MemorialSaldoFonteService } from '../services/memorial-saldo-fonte.js'
import { ValoresMensaisService } from '../services/valores-mensais.js'
import { SaldoBancarioMensalService } from '../services/saldo-bancario-mensal.js'

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
export const CONTRATO_MEMORIAIS = { nome: 'memoriais-lrf', versao: '1.2.0' } as const

/**
 * Contrato SEPARADO dos VALORES MENSAIS granulares (alimenta o painel do Oxy).
 * Versão própria, independente do `memoriais-lrf`. O oxy-bi-jpa valida este
 * `versao` na resposta antes de agregar. Ver `oxy-repo/INTEGRACAO-GENESIS.md`.
 */
export const CONTRATO_VALORES_MENSAIS = { nome: 'valores-mensais', versao: '1.0.0' } as const

/** Contrato do saldo bancário consolidado por mês (painel do Oxy). Versão própria. */
export const CONTRATO_SALDO_BANCARIO = { nome: 'saldo-bancario', versao: '1.0.0' } as const

/** Descritor do contrato: o que o Oxy pode validar antes de consumir. */
export function descreverContrato() {
  return {
    ...CONTRATO_MEMORIAIS,
    recursos: [
      { recurso: 'rcl', campos: ['entidade', 'ano', 'metodologia', 'temOrcamento', 'correntes', 'correntesTotal', 'deducoes', 'deducoesTotal', 'rcl'] },
      { recurso: 'rcl-consolidada', campos: ['municipio', 'estado', 'ano', 'metodologia', 'entidades', 'correntesTotal', 'deducoesTotal', 'intra', 'rclTotal'] },
      { recurso: 'guardiao', campos: ['entidade', 'ano', 'metodologia', 'temOrcamento', 'indicadores'] },
      { recurso: 'saldo-fonte', campos: ['entidade', 'ano', 'metodologia', 'receita', 'despesa'] },
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
  const guardiaoSvc = new MemorialGuardiaoService(app.prisma)
  const saldoFonteSvc = new MemorialSaldoFonteService(app.prisma)
  const valoresSvc = new ValoresMensaisService(app.prisma)
  const saldoBancarioSvc = new SaldoBancarioMensalService(app.prisma)

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

  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/guardiao', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const r = await guardiaoSvc.guardiao(p.entidadeId, p.ano)
    if (!r) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send(envelope('guardiao', r))
  })

  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/saldo-fonte', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const r = await saldoFonteSvc.saldoFonte(p.entidadeId, p.ano)
    if (!r) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send(envelope('saldo-fonte', r))
  })

  // Valores mensais granulares p/ o painel do Oxy (contrato próprio `valores-mensais`).
  app.get<{ Querystring: { entidadeId?: string; ano?: string; tipo?: string } }>('/memoriais/valores-mensais', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const tipo = req.query.tipo
    if (tipo !== 'receita' && tipo !== 'despesa') return reply.code(400).send({ erro: 'tipo deve ser receita ou despesa.' })
    const dados = tipo === 'receita' ? await valoresSvc.receita(p.entidadeId, p.ano) : await valoresSvc.despesa(p.entidadeId, p.ano)
    if (!dados) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send({ contrato: { ...CONTRATO_VALORES_MENSAIS, recurso: tipo }, dados })
  })

  // Saldo bancário consolidado por mês (contrato próprio `saldo-bancario`).
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/saldo-bancario', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const dados = await saldoBancarioSvc.consolidar(p.entidadeId, p.ano)
    if (!dados) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send({ contrato: { ...CONTRATO_SALDO_BANCARIO, recurso: 'saldo-bancario' }, dados })
  })
}
