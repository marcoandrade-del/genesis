import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { MemorialRclService } from '../services/memorial-rcl.js'
import { MemorialGuardiaoService } from '../services/memorial-guardiao.js'
import { MemorialSaldoFonteService } from '../services/memorial-saldo-fonte.js'
import { IndiceConstitucionalService, composicaoIndicesDoEstado } from '../services/indice-constitucional.js'
import { DisponibilidadeFonteService } from '../services/disponibilidade-fonte.js'
import { MetasFiscaisService } from '../services/metas-fiscais.js'
import { ValoresMensaisService } from '../services/valores-mensais.js'
import { SaldoBancarioMensalService } from '../services/saldo-bancario-mensal.js'
import { DclService } from '../services/dcl.js'
import { RgfSimplificadoService } from '../services/rgf-simplificado.js'
import { ConsistenciaService } from '../services/consistencia.js'
import { MatrizSaldosContabeisService } from '../services/matriz-saldos-contabeis.js'

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
export const CONTRATO_MEMORIAIS = { nome: 'memoriais-lrf', versao: '1.14.0' } as const

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
      { recurso: 'rcl', campos: ['entidade', 'ano', 'metodologia', 'temOrcamento', 'correntes', 'correntesTotal', 'deducoes', 'deducoesTotal', 'rcl', 'correntesRealizadoTotal', 'deducoesRealizadoTotal', 'rclRealizado'] },
      { recurso: 'rcl-consolidada', campos: ['municipio', 'estado', 'ano', 'metodologia', 'entidades', 'correntesTotal', 'deducoesTotal', 'intra', 'rclTotal'] },
      { recurso: 'guardiao', campos: ['entidade', 'ano', 'metodologia', 'temOrcamento', 'indicadores'] },
      { recurso: 'saldo-fonte', campos: ['entidade', 'ano', 'metodologia', 'receita', 'despesa'] },
      { recurso: 'indices-constitucionais', campos: ['temOrcamento', 'metodologia', 'base', 'baseTotal', 'mde', 'asps'] },
      { recurso: 'disponibilidade-fonte', campos: ['temDados', 'linhas', 'totais'] },
      { recurso: 'metas-fiscais', campos: ['temMetas', 'linhas'] },
      { recurso: 'dcl', campos: ['dividaPorCategoria', 'dividaTotal', 'deducoes', 'dcl', 'metaLdo', 'temDivida'] },
      { recurso: 'rgf-simplificado', campos: ['temOrcamento', 'rcl', 'rclRealizada', 'linhas', 'disponibilidade'] },
      { recurso: 'consistencia', campos: ['verificacoes', 'selo'] },
      { recurso: 'despesa-consolidada', campos: ['municipio', 'estado', 'ano', 'entidades', 'empenhadoBruto', 'intraEliminada', 'empenhadoConsolidado'] },
      { recurso: 'receita-consolidada', campos: ['municipio', 'estado', 'ano', 'entidades', 'arrecadadoBruto', 'intraEliminada', 'arrecadadoConsolidado'] },
      { recurso: 'msc', campos: ['entidade', 'ano', 'mes', 'tipo', 'metodologia', 'linhas', 'verificacoes', 'selo'] },
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
  const indicesSvc = new IndiceConstitucionalService(app.prisma)
  const disponibilidadeSvc = new DisponibilidadeFonteService(app.prisma)
  const metasSvc = new MetasFiscaisService(app.prisma)
  const dclSvc = new DclService(app.prisma)
  const rgfSimplesSvc = new RgfSimplificadoService(app.prisma)
  const consistenciaSvc = new ConsistenciaService(app.prisma)
  const mscSvc = new MatrizSaldosContabeisService(app.prisma)

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

  // Despesa consolidada do ENTE = soma das entidades − intra-orçamentária (mod 91).
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/despesa-consolidada', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const r = await svc.despesaConsolidada(p.entidadeId, p.ano)
    if (!r) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send(envelope('despesa-consolidada', r))
  })

  // Receita consolidada do ENTE = soma das entidades − receita intra (cat 7/8).
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/receita-consolidada', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const r = await svc.receitaConsolidada(p.entidadeId, p.ano)
    if (!r) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send(envelope('receita-consolidada', r))
  })

  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/guardiao', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const r = await guardiaoSvc.guardiao(p.entidadeId, p.ano)
    if (!r) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send(envelope('guardiao', r))
  })

  // Índices constitucionais MDE 25% / ASPS 15% (função × fonte real do QDD).
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/indices-constitucionais', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const ent = await app.prisma.entidade.findUnique({
      where: { id: p.entidadeId },
      select: { municipio: { select: { estado: { select: { sigla: true } } } } },
    })
    if (!ent) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    const comp = composicaoIndicesDoEstado(ent.municipio?.estado?.sigla)
    const r = await indicesSvc.calcular(p.entidadeId, p.ano, comp)
    return reply.send(envelope('indices-constitucionais', r))
  })

  // RGF Anexo 5 — disponibilidade de caixa e restos a pagar por fonte.
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/disponibilidade-fonte', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const ent = await app.prisma.entidade.findUnique({ where: { id: p.entidadeId }, select: { id: true } })
    if (!ent) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    const r = await disponibilidadeSvc.calcular(p.entidadeId, p.ano)
    return reply.send(envelope('disponibilidade-fonte', r))
  })

  // Metas fiscais da LDO × projetado da LOA.
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/metas-fiscais', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const ent = await app.prisma.entidade.findUnique({ where: { id: p.entidadeId }, select: { id: true } })
    if (!ent) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    const r = await metasSvc.comparativo(p.entidadeId, p.ano)
    return reply.send(envelope('metas-fiscais', r))
  })

  // RGF Anexo 2 — DCL viva (dívida do cadastro − deduções de caixa/RP).
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/dcl', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const ent = await app.prisma.entidade.findUnique({ where: { id: p.entidadeId }, select: { id: true } })
    if (!ent) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    const r = await dclSvc.calcular(p.entidadeId, p.ano)
    return reply.send(envelope('dcl', r))
  })

  // RGF Anexo 6 — quadro-resumo dos limites (q = quadrimestre 1|2|3; default 3).
  app.get<{ Querystring: { entidadeId?: string; ano?: string; q?: string } }>('/memoriais/rgf-simplificado', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const ent = await app.prisma.entidade.findUnique({ where: { id: p.entidadeId }, select: { id: true } })
    if (!ent) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    const q = req.query.q === '1' ? 1 : req.query.q === '2' ? 2 : 3
    const r = await rgfSimplesSvc.calcular(p.entidadeId, p.ano, q)
    return reply.send(envelope('rgf-simplificado', r))
  })

  // SELO DE CONSISTÊNCIA — bateria de identidades contábeis (o OXY exibe o selo
  // "N de M verificações" antes da análise de IA; divergência vem com Δ exposto).
  app.get<{ Querystring: { entidadeId?: string; ano?: string } }>('/memoriais/consistencia', async (req, reply) => {
    const p = params(req)
    if (!p) return reply.code(400).send({ erro: 'entidadeId e ano são obrigatórios.' })
    const ent = await app.prisma.entidade.findUnique({ where: { id: p.entidadeId }, select: { id: true } })
    if (!ent) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    const r = await consistenciaSvc.verificar(p.entidadeId, p.ano)
    return reply.send(envelope('consistencia', r))
  })

  // MATRIZ DE SALDOS CONTÁBEIS (MSC) — balancete analítico no leiaute da STN
  // (Siconfi), mês a mês (SI/MD/MC/SF). Keystone do medidor de ICF; o razão
  // único faz a MSC fechar por construção com RREO/RGF.
  app.get<{ Querystring: { entidadeId?: string; ano?: string; mes?: string } }>('/memoriais/msc', async (req, reply) => {
    const entidadeId = req.query.entidadeId
    const ano = parseInt(String(req.query.ano ?? ''), 10)
    const mes = parseInt(String(req.query.mes ?? ''), 10)
    if (!entidadeId || !Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12)
      return reply.code(400).send({ erro: 'entidadeId, ano e mes (1..12) são obrigatórios.' })
    const r = await mscSvc.emitir(entidadeId, ano, mes)
    if (!r) return reply.code(404).send({ erro: 'Entidade não encontrada.' })
    return reply.send(envelope('msc', r))
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
