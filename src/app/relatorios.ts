import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  CabecalhosRodapesService,
  ELEMENTOS_CABECALHO,
  ELEMENTOS_RODAPE,
  ROTULOS_ELEMENTO,
} from '../services/cabecalhos-rodapes.js'
import { MeusRelatoriosService } from '../services/meus-relatorios.js'
import { criarExecutorPadrao } from '../services/relatorio-executor.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

type Tipo = 'CABECALHO' | 'RODAPE'
type CorpoTemplate = { nome?: string; altura?: string; layout?: string }
type CorpoRelatorio = { nome?: string; descricao?: string; query?: string; cabecalhoId?: string; rodapeId?: string }

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'

// Lê o JSON do layout vindo do form. Lança em JSON malformado (só acontece com
// payload adulterado — o editor sempre envia JSON válido).
function parseLayoutJson(raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return []
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    throw new ErroNegocio('REQUISICAO_INVALIDA', 'Layout inválido (JSON malformado).')
  }
}

// Versão tolerante: usada só para repreencher o canvas ao re-renderizar após erro.
function lerLayoutSeguro(raw: unknown): unknown[] {
  try {
    const v = parseLayoutJson(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/**
 * Área "Relatórios" do operador (/app). Por ora, gestão dos templates de
 * cabeçalho e rodapé, escopados pela entidade do contexto. Escrita exige nível
 * ESCRITA/ADMIN; LEITURA apenas lista.
 */
export async function appRelatoriosRoutes(app: FastifyInstance) {
  const svc = new CabecalhosRodapesService(app.prisma)
  const meus = new MeusRelatoriosService(app.prisma)
  const executor = criarExecutorPadrao()

  const carregarEntidade = (entidadeId: string) =>
    app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })

  // Renderiza o hub (listas + erro opcional). Mostra templates (cabeçalho/rodapé,
  // da entidade) e os relatórios do usuário naquela entidade.
  async function renderHub(
    reply: FastifyReply,
    entidade: unknown,
    ano: number,
    nivel: string,
    entidadeId: string,
    usuarioId: string,
    opts: { erro?: string; status?: number } = {},
  ) {
    const [cabecalhos, rodapes, relatorios] = await Promise.all([
      svc.listarCabecalhos(entidadeId),
      svc.listarRodapes(entidadeId),
      meus.listar(usuarioId, entidadeId),
    ])
    if (opts.status) reply.code(opts.status)
    return reply.view('app/relatorios', {
      entidade,
      ano,
      nivel,
      cabecalhos,
      rodapes,
      relatorios,
      podeEscrever: podeEscrever(nivel),
      erro: opts.erro ?? null,
      layout: null,
    })
  }

  // ── Hub ───────────────────────────────────────────────────────
  app.get('/relatorios', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub)
  })

  // Registra as 5 rotas de um tipo de template (cabeçalho ou rodapé).
  function registrarTemplate(tipo: Tipo) {
    const isCab = tipo === 'CABECALHO'
    const base = isCab ? '/relatorios/cabecalhos' : '/relatorios/rodapes'
    const tipos = isCab ? ELEMENTOS_CABECALHO : ELEMENTOS_RODAPE
    const elementos = tipos.map((t) => ({ tipo: t, label: ROTULOS_ELEMENTO[t] }))
    const ops = isCab
      ? {
          buscar: (id: string) => svc.buscarCabecalho(id),
          criar: (e: string, u: string, d: CorpoTemplate & { layout: unknown }) => svc.criarCabecalho(e, u, d),
          atualizar: (id: string, e: string, d: CorpoTemplate & { layout: unknown }) => svc.atualizarCabecalho(id, e, d),
          excluir: (id: string, e: string) => svc.excluirCabecalho(id, e),
        }
      : {
          buscar: (id: string) => svc.buscarRodape(id),
          criar: (e: string, u: string, d: CorpoTemplate & { layout: unknown }) => svc.criarRodape(e, u, d),
          atualizar: (id: string, e: string, d: CorpoTemplate & { layout: unknown }) => svc.atualizarRodape(id, e, d),
          excluir: (id: string, e: string) => svc.excluirRodape(id, e),
        }

    function renderEditor(
      reply: FastifyReply,
      entidade: unknown,
      ano: number,
      nivel: string,
      registro: { id?: string; nome: string; altura: number | string; layout: unknown[] } | null,
      opts: { erro?: string; status?: number } = {},
    ) {
      if (opts.status) reply.code(opts.status)
      return reply.view('app/relatorios-editor', {
        tipo,
        base,
        elementos,
        rotulos: ROTULOS_ELEMENTO,
        entidade,
        ano,
        nivel,
        registro,
        erro: opts.erro ?? null,
        layout: null,
      })
    }

    // GET novo — formulário em branco
    app.get(`${base}/novo`, async (req, reply) => {
      const { entidadeId, ano, nivel } = req.contexto
      const entidade = await carregarEntidade(entidadeId)
      if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      if (!podeEscrever(nivel)) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
      }
      return renderEditor(reply, entidade, ano, nivel, null)
    })

    // GET editar — carrega registro existente da entidade
    app.get<{ Params: { id: string } }>(`${base}/:id`, async (req, reply) => {
      const { entidadeId, ano, nivel } = req.contexto
      const entidade = await carregarEntidade(entidadeId)
      if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      if (!podeEscrever(nivel)) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
      }
      const reg = await ops.buscar(req.params.id)
      if (!reg || reg.entidadeId !== entidadeId) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: 'Template não encontrado.', status: 404 })
      }
      return renderEditor(reply, entidade, ano, nivel, {
        id: reg.id,
        nome: reg.nome,
        altura: reg.altura,
        layout: Array.isArray(reg.layout) ? (reg.layout as unknown[]) : [],
      })
    })

    // POST criar
    app.post<{ Body: CorpoTemplate }>(base, async (req, reply) => {
      const { entidadeId, ano, nivel } = req.contexto
      const entidade = await carregarEntidade(entidadeId)
      if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      if (!podeEscrever(nivel)) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
      }
      const body = req.body ?? {}
      try {
        await ops.criar(entidadeId, req.user.sub, { ...body, layout: parseLayoutJson(body.layout) })
        return reply.redirect('/app/relatorios')
      } catch (e) {
        if (e instanceof ErroNegocio) {
          return renderEditor(
            reply,
            entidade,
            ano,
            nivel,
            { nome: body.nome ?? '', altura: body.altura ?? '', layout: lerLayoutSeguro(body.layout) },
            { erro: e.message, status: statusDeErro(e.code) },
          )
        }
        throw e
      }
    })

    // POST atualizar
    app.post<{ Params: { id: string }; Body: CorpoTemplate }>(`${base}/:id`, async (req, reply) => {
      const { entidadeId, ano, nivel } = req.contexto
      const entidade = await carregarEntidade(entidadeId)
      if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      if (!podeEscrever(nivel)) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
      }
      const body = req.body ?? {}
      try {
        await ops.atualizar(req.params.id, entidadeId, { ...body, layout: parseLayoutJson(body.layout) })
        return reply.redirect('/app/relatorios')
      } catch (e) {
        if (e instanceof ErroNegocio) {
          return renderEditor(
            reply,
            entidade,
            ano,
            nivel,
            { id: req.params.id, nome: body.nome ?? '', altura: body.altura ?? '', layout: lerLayoutSeguro(body.layout) },
            { erro: e.message, status: statusDeErro(e.code) },
          )
        }
        throw e
      }
    })

    // POST excluir
    app.post<{ Params: { id: string } }>(`${base}/:id/excluir`, async (req, reply) => {
      const { entidadeId, ano, nivel } = req.contexto
      const entidade = await carregarEntidade(entidadeId)
      if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      if (!podeEscrever(nivel)) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
      }
      try {
        await ops.excluir(req.params.id, entidadeId)
        return reply.redirect('/app/relatorios')
      } catch (e) {
        if (e instanceof ErroNegocio) {
          return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: e.message, status: statusDeErro(e.code) })
        }
        throw e
      }
    })
  }

  registrarTemplate('CABECALHO')
  registrarTemplate('RODAPE')

  // ── Meus Relatórios (relatório com query + cabeçalho/rodapé) ───
  const baseRel = '/relatorios/meus'

  async function renderRelEditor(
    reply: FastifyReply,
    entidade: unknown,
    ano: number,
    nivel: string,
    entidadeId: string,
    registro: CorpoRelatorio & { id?: string } | null,
    opts: { erro?: string; status?: number } = {},
  ) {
    const [cabecalhos, rodapes] = await Promise.all([svc.listarCabecalhos(entidadeId), svc.listarRodapes(entidadeId)])
    if (opts.status) reply.code(opts.status)
    return reply.view('app/relatorios-relatorio-editor', {
      entidade,
      ano,
      nivel,
      registro,
      cabecalhos,
      rodapes,
      erro: opts.erro ?? null,
      layout: null,
    })
  }

  // GET novo
  app.get(`${baseRel}/novo`, async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    if (!podeEscrever(nivel)) return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
    return renderRelEditor(reply, entidade, ano, nivel, entidadeId, null)
  })

  // GET editar
  app.get<{ Params: { id: string } }>(`${baseRel}/:id`, async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    if (!podeEscrever(nivel)) return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
    const reg = await meus.buscar(req.params.id)
    if (!reg || reg.usuarioId !== req.user.sub || reg.entidadeId !== entidadeId) {
      return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: 'Relatório não encontrado.', status: 404 })
    }
    return renderRelEditor(reply, entidade, ano, nivel, entidadeId, {
      id: reg.id,
      nome: reg.nome,
      descricao: reg.descricao ?? '',
      query: reg.query ?? '',
      cabecalhoId: reg.cabecalhoId ?? '',
      rodapeId: reg.rodapeId ?? '',
    })
  })

  // POST criar
  app.post<{ Body: CorpoRelatorio }>(baseRel, async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    if (!podeEscrever(nivel)) return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
    const body = req.body ?? {}
    try {
      await meus.criar(req.user.sub, entidadeId, body)
      return reply.redirect('/app/relatorios')
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderRelEditor(reply, entidade, ano, nivel, entidadeId, { ...body }, { erro: e.message, status: statusDeErro(e.code) })
      }
      throw e
    }
  })

  // POST atualizar
  app.post<{ Params: { id: string }; Body: CorpoRelatorio }>(`${baseRel}/:id`, async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    if (!podeEscrever(nivel)) return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
    const body = req.body ?? {}
    try {
      await meus.atualizar(req.params.id, req.user.sub, entidadeId, body)
      return reply.redirect('/app/relatorios')
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderRelEditor(reply, entidade, ano, nivel, entidadeId, { id: req.params.id, ...body }, { erro: e.message, status: statusDeErro(e.code) })
      }
      throw e
    }
  })

  // POST excluir
  app.post<{ Params: { id: string } }>(`${baseRel}/:id/excluir`, async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    if (!podeEscrever(nivel)) return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
    try {
      await meus.excluir(req.params.id, req.user.sub, entidadeId)
      return reply.redirect('/app/relatorios')
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: e.message, status: statusDeErro(e.code) })
      }
      throw e
    }
  })

  // GET executar — preview HTML. LEITURA também pode (executar é leitura).
  app.get<{ Params: { id: string } }>(`${baseRel}/:id/executar`, async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    const reg = await meus.buscar(req.params.id)
    if (!reg || reg.usuarioId !== req.user.sub || reg.entidadeId !== entidadeId) {
      return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: 'Relatório não encontrado.', status: 404 })
    }
    let resultado = null
    let erro: string | null = null
    try {
      resultado = await executor.executar(reg.query ?? '', { entidadeId, ano })
    } catch (e) {
      if (e instanceof ErroNegocio) {
        erro = e.message
        reply.code(statusDeErro(e.code))
      } else {
        throw e
      }
    }
    return reply.view('app/relatorios-preview', {
      entidade,
      ano,
      nivel,
      relatorio: reg,
      cabecalho: reg.cabecalho,
      rodape: reg.rodape,
      resultado,
      erro,
      geradoEm: new Date(),
      layout: null,
    })
  })
}

const ERRO_LEITURA =
  'Seu nível de acesso nesta entidade é apenas leitura — você pode visualizar e executar, mas não criar ou editar.'
