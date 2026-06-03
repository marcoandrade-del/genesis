import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  CabecalhosRodapesService,
  ELEMENTOS_CABECALHO,
  ELEMENTOS_RODAPE,
  ROTULOS_ELEMENTO,
} from '../services/cabecalhos-rodapes.js'
import { ErroNegocio, statusDeErro } from '../errors.js'

type Tipo = 'CABECALHO' | 'RODAPE'
type CorpoTemplate = { nome?: string; altura?: string; layout?: string }

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

  const carregarEntidade = (entidadeId: string) =>
    app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })

  // Renderiza o hub (listas + erro opcional).
  async function renderHub(
    reply: FastifyReply,
    entidade: unknown,
    ano: number,
    nivel: string,
    entidadeId: string,
    opts: { erro?: string; status?: number } = {},
  ) {
    const [cabecalhos, rodapes] = await Promise.all([
      svc.listarCabecalhos(entidadeId),
      svc.listarRodapes(entidadeId),
    ])
    if (opts.status) reply.code(opts.status)
    return reply.view('app/relatorios', {
      entidade,
      ano,
      nivel,
      cabecalhos,
      rodapes,
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
    return renderHub(reply, entidade, ano, nivel, entidadeId)
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
        return renderHub(reply, entidade, ano, nivel, entidadeId, { erro: ERRO_LEITURA, status: 403 })
      }
      return renderEditor(reply, entidade, ano, nivel, null)
    })

    // GET editar — carrega registro existente da entidade
    app.get<{ Params: { id: string } }>(`${base}/:id`, async (req, reply) => {
      const { entidadeId, ano, nivel } = req.contexto
      const entidade = await carregarEntidade(entidadeId)
      if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      if (!podeEscrever(nivel)) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, { erro: ERRO_LEITURA, status: 403 })
      }
      const reg = await ops.buscar(req.params.id)
      if (!reg || reg.entidadeId !== entidadeId) {
        return renderHub(reply, entidade, ano, nivel, entidadeId, { erro: 'Template não encontrado.', status: 404 })
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
        return renderHub(reply, entidade, ano, nivel, entidadeId, { erro: ERRO_LEITURA, status: 403 })
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
        return renderHub(reply, entidade, ano, nivel, entidadeId, { erro: ERRO_LEITURA, status: 403 })
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
        return renderHub(reply, entidade, ano, nivel, entidadeId, { erro: ERRO_LEITURA, status: 403 })
      }
      try {
        await ops.excluir(req.params.id, entidadeId)
        return reply.redirect('/app/relatorios')
      } catch (e) {
        if (e instanceof ErroNegocio) {
          return renderHub(reply, entidade, ano, nivel, entidadeId, { erro: e.message, status: statusDeErro(e.code) })
        }
        throw e
      }
    })
  }

  registrarTemplate('CABECALHO')
  registrarTemplate('RODAPE')
}

const ERRO_LEITURA =
  'Seu nível de acesso nesta entidade é apenas leitura — você pode visualizar, mas não criar ou editar templates.'
