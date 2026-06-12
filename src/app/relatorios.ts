import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  CabecalhosRodapesService,
  ELEMENTOS_CABECALHO,
  ELEMENTOS_RODAPE,
  ROTULOS_ELEMENTO,
} from '../services/cabecalhos-rodapes.js'
import { MeusRelatoriosService } from '../services/meus-relatorios.js'
import { MeusRelatoriosOrgService } from '../services/meus-relatorios-org.js'
import { criarExecutorPadrao } from '../services/relatorio-executor.js'
import { montarTemplateFaixa, montarCorpoHtml, margemParaFaixa, gerarPdf, type Faixa } from '../services/relatorio-pdf.js'
import { exportarResultado, formatoValido, nomeArquivo, FORMATOS } from '../services/relatorio-export.js'
import {
  montarRender,
  linhasPorPagina,
  lerTotaisConfig,
  configEfetiva,
  rotuloPadrao,
  analisarColunas,
  AGG_TIPOS,
  type TotaisConfig,
} from '../services/relatorio-totais.js'
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
  const org = new MeusRelatoriosOrgService(app.prisma)
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
    const [cabecalhos, rodapes, arvore, pastas] = await Promise.all([
      svc.listarCabecalhos(entidadeId),
      svc.listarRodapes(entidadeId),
      org.arvore(usuarioId, entidadeId),
      org.listarPastas(usuarioId, entidadeId),
    ])
    if (opts.status) reply.code(opts.status)
    return reply.view('app/relatorios', {
      entidade,
      ano,
      nivel,
      cabecalhos,
      rodapes,
      arvore,
      pastas,
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

  // Views rel_* para o picker do editor. Falha do sandbox não pode derrubar o
  // editor (o picker é conveniência) — degrada para lista vazia.
  async function listarViewsSeguro() {
    try {
      return await executor.listarViews()
    } catch {
      return []
    }
  }

  // Painel de totais no design: as colunas só existem executando a query salva.
  // Query inválida/sandbox fora → sem painel (configura-se depois, pela prévia).
  async function montarTotaisDoEditor(
    reg: { query: string | null; configuracao?: unknown },
    entidadeId: string,
    ano: number,
  ) {
    if (!reg.query) return null
    try {
      const resultado = await executor.executar(reg.query, { entidadeId, ano })
      return montarPainelTotais(resultado, lerTotaisConfig(reg.configuracao), analisarColunas(resultado).numericas)
    } catch {
      return null
    }
  }

  async function renderRelEditor(
    reply: FastifyReply,
    entidade: unknown,
    ano: number,
    nivel: string,
    entidadeId: string,
    registro: CorpoRelatorio & { id?: string } | null,
    opts: { erro?: string; status?: number; totais?: ReturnType<typeof montarPainelTotais> | null } = {},
  ) {
    const [cabecalhos, rodapes, views] = await Promise.all([
      svc.listarCabecalhos(entidadeId),
      svc.listarRodapes(entidadeId),
      listarViewsSeguro(),
    ])
    if (opts.status) reply.code(opts.status)
    return reply.view('app/relatorios-relatorio-editor', {
      entidade,
      ano,
      nivel,
      registro,
      cabecalhos,
      rodapes,
      views,
      totais: opts.totais ?? null,
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
    }, { totais: await montarTotaisDoEditor(reg, entidadeId, ano) })
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
    const porPagina = linhasPorPagina(margemParaFaixa(reg.cabecalho, 12), margemParaFaixa(reg.rodape, 12))
    const cfgSalva = lerTotaisConfig(reg.configuracao)
    const render = resultado ? montarRender(resultado, porPagina, cfgSalva) : null
    return reply.view('app/relatorios-preview', {
      entidade,
      ano,
      nivel,
      relatorio: reg,
      cabecalho: reg.cabecalho,
      rodape: reg.rodape,
      formatos: FORMATOS,
      resultado,
      render,
      totais: resultado && render ? montarPainelTotais(resultado, cfgSalva, render.numericas) : null,
      podeEscrever: podeEscrever(nivel),
      erro,
      geradoEm: new Date(),
      layout: null,
    })
  })

  // POST salvar configuração de totais (painel da prévia OU do design). Corpo:
  // campo `totais` com o JSON da config (vazio = voltar ao automático) e
  // `voltar=editor` quando o painel está na tela de design.
  app.post<{ Params: { id: string }; Body: { totais?: string; voltar?: string } }>(`${baseRel}/:id/totais`, async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    if (!podeEscrever(nivel)) return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
    try {
      const raw = req.body?.totais
      let parsed: unknown = raw
      if (typeof raw === 'string' && raw.trim()) {
        try {
          parsed = JSON.parse(raw)
        } catch {
          throw new ErroNegocio('REQUISICAO_INVALIDA', 'Configuração de totais inválida (JSON malformado).')
        }
      }
      await meus.salvarTotais(req.params.id, req.user.sub, entidadeId, parsed)
      const sufixo = req.body?.voltar === 'editor' ? '' : '/executar'
      return reply.redirect(`/app/relatorios/meus/${req.params.id}${sufixo}`)
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: e.message, status: statusDeErro(e.code) })
      }
      throw e
    }
  })

  // Boilerplate comum às mutações: carrega entidade, exige escrita, redireciona
  // no sucesso e re-renderiza o hub com a mensagem em caso de ErroNegocio.
  async function comEscrita(
    req: FastifyRequest,
    reply: FastifyReply,
    acao: (entidadeId: string, usuarioId: string) => Promise<unknown>,
  ) {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    if (!podeEscrever(nivel)) {
      return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: ERRO_LEITURA, status: 403 })
    }
    try {
      await acao(entidadeId, req.user.sub)
      return reply.redirect('/app/relatorios')
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: e.message, status: statusDeErro(e.code) })
      }
      throw e
    }
  }

  // ── Pastas de "Meus Relatórios" ───────────────────────────────
  app.post<{ Body: { nome?: string; parentId?: string } }>('/relatorios/pastas', (req, reply) =>
    comEscrita(req, reply, (eid, uid) => org.criarPasta(uid, eid, req.body ?? {})),
  )
  app.post<{ Params: { id: string }; Body: { nome?: string } }>('/relatorios/pastas/:id', (req, reply) =>
    comEscrita(req, reply, (eid, uid) => org.renomearPasta(req.params.id, uid, eid, req.body?.nome)),
  )
  app.post<{ Params: { id: string } }>('/relatorios/pastas/:id/excluir', (req, reply) =>
    comEscrita(req, reply, (eid, uid) => org.excluirPasta(req.params.id, uid, eid)),
  )
  // Mover um relatório para uma pasta (pastaId vazio = sem pasta).
  app.post<{ Params: { id: string }; Body: { pastaId?: string } }>('/relatorios/meus/:id/pasta', (req, reply) =>
    comEscrita(req, reply, (eid, uid) => org.atribuirRelatorio(req.params.id, uid, eid, req.body?.pastaId)),
  )

  // ── Exportar PDF (Playwright) — LEITURA pode (é leitura) ───────
  app.get<{ Params: { id: string } }>('/relatorios/meus/:id/pdf', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    const reg = await meus.buscar(req.params.id)
    if (!reg || reg.usuarioId !== req.user.sub || reg.entidadeId !== entidadeId) {
      return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: 'Relatório não encontrado.', status: 404 })
    }
    try {
      const resultado = await executor.executar(reg.query ?? '', { entidadeId, ano })
      const pdf = await montarPdfBuffer(reg, resultado, entidade)
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${nomeArquivo(reg.nome, 'pdf')}"`)
        .send(pdf)
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: e.message, status: statusDeErro(e.code) })
      }
      throw e
    }
  })

  // ── Exportar em vários formatos (HTML/TXT/PDF/CSV/XLS/DOC/XML/JSON) ──
  // LEITURA pode (é leitura). PDF reaproveita o Playwright; o resto, o módulo
  // de exportação. Formatos de dados baixam como anexo; HTML/PDF abrem na aba.
  app.get<{ Params: { id: string; formato: string } }>('/relatorios/meus/:id/exportar/:formato', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await carregarEntidade(entidadeId)
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    const formato = req.params.formato
    if (!formatoValido(formato)) {
      return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: 'Formato de exportação inválido.', status: 400 })
    }
    const reg = await meus.buscar(req.params.id)
    if (!reg || reg.usuarioId !== req.user.sub || reg.entidadeId !== entidadeId) {
      return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: 'Relatório não encontrado.', status: 404 })
    }
    try {
      const resultado = await executor.executar(reg.query ?? '', { entidadeId, ano })
      if (formato === 'pdf') {
        const pdf = await montarPdfBuffer(reg, resultado, entidade)
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `inline; filename="${nomeArquivo(reg.nome, 'pdf')}"`)
          .send(pdf)
      }
      const arq = await exportarResultado(
        formato,
        { colunas: resultado.colunas, linhas: resultado.linhas, truncado: resultado.truncado },
        reg.nome,
        lerTotaisConfig(reg.configuracao),
      )
      return reply
        .header('Content-Type', arq.mime)
        .header('Content-Disposition', `${arq.download ? 'attachment' : 'inline'}; filename="${nomeArquivo(reg.nome, arq.ext)}"`)
        .send(arq.conteudo)
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, req.user.sub, { erro: e.message, status: statusDeErro(e.code) })
      }
      throw e
    }
  })
}

/** Dados do painel "Totais" (prévia e design): config efetiva + metadados p/ o form. */
function montarPainelTotais(
  resultado: { colunas: string[]; linhas: unknown[][] },
  cfgSalva: TotaisConfig | null,
  numericas: boolean[],
) {
  return {
    cfg: configEfetiva(resultado, cfgSalva),
    automatico: cfgSalva === null,
    colunas: resultado.colunas,
    numericas,
    aggTipos: AGG_TIPOS,
    rotulosPadrao: Object.fromEntries(
      resultado.colunas.map((c) => [c, Object.fromEntries(AGG_TIPOS.map((a) => [a.id, rotuloPadrao(a.id, c)]))]),
    ),
  }
}

/** Monta o PDF (A4 com cabeçalho/rodapé repetidos) a partir do resultado. */
async function montarPdfBuffer(
  reg: { nome: string; cabecalho: Faixa; rodape: Faixa; configuracao?: unknown },
  resultado: { colunas: string[]; linhas: unknown[][]; truncado?: boolean },
  entidade: { nome: string; endereco: string | null; brasao: string | null },
): Promise<Buffer> {
  const geradoEm = new Date()
  const dadosFaixa = {
    nomeEntidade: entidade.nome,
    enderecoEntidade: entidade.endereco ?? '',
    nomeRelatorio: reg.nome,
    brasao: entidade.brasao ?? null,
    dataGeracao: geradoEm.toLocaleDateString('pt-BR'),
    horaGeracao: geradoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  }
  const margemTopoMm = margemParaFaixa(reg.cabecalho, 12)
  const margemRodapeMm = margemParaFaixa(reg.rodape, 12)
  return gerarPdf({
    corpoHtml: montarCorpoHtml(resultado, reg.nome, linhasPorPagina(margemTopoMm, margemRodapeMm), lerTotaisConfig(reg.configuracao)),
    header: montarTemplateFaixa(reg.cabecalho, dadosFaixa),
    footer: montarTemplateFaixa(reg.rodape, dadosFaixa),
    margemTopoMm,
    margemRodapeMm,
  })
}

const ERRO_LEITURA =
  'Seu nível de acesso nesta entidade é apenas leitura — você pode visualizar e executar, mas não criar ou editar.'
