import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { calcularSelo } from '../conversor/selo.js'
import { importarMunicipio } from '../conversor/importar.js'
import { fabricantesConversor, tiposEntidade } from '../conversor/fabricantes/campos.js'
import { fontesExecucao } from '../conversor/tce/registry.js'
import {
  listarMunicipios,
  carregarMunicipio,
  carregarConfig,
  criarMunicipio,
  adicionarEntidade,
  atualizarEntidade,
  removerEntidade,
  definirParamMunicipio,
  definirParamEntidade,
} from '../conversor/config-store.js'
import { salvarUpload, nomeArquivo } from '../conversor/uploads.js'
import type { TipoEntidade } from '../conversor/nucleo/tipos.js'

const podeEscrever = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'
const ERRO_LEITURA = 'Seu nível de acesso é apenas leitura — você não pode cadastrar ou converter municípios.'

// Uma conversão por vez, por município (roda por minutos e escreve na base).
const emExecucao = new Set<string>()
// Último resultado de conversão por município (in-memory, como a tela Sincronização).
const ultimoLog = new Map<string, { quando: Date; linhas: string[]; erro: string | null }>()

const tiposValidos = new Set<TipoEntidade>(['PREFEITURA', 'CAMARA', 'ADM_INDIRETA'])
const asTipo = (v: unknown): TipoEntidade => (tiposValidos.has(v as TipoEntidade) ? (v as TipoEntidade) : 'ADM_INDIRETA')
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Coleta os params de TEXTO de escopo entidade do fabricante a partir do body. */
const paramsTextoDoBody = (fabricante: string, b: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const c of fabricantesConversor[fabricante]?.campos ?? []) {
    if (c.escopo === 'entidade' && c.tipo === 'texto') {
      const v = str(b[c.chave])
      if (v) out[c.chave] = v
    }
  }
  return out
}

/**
 * Conversor de municípios — cadastro (config-as-data), upload dos exports do
 * portal do fabricante e o botão "Converter" que roda o pipeline (orçamentário
 * do fabricante + execução do TCE). O painel/Selo (o que converteu, o que bate)
 * segue em GET /conversor, escopado ao município do contexto atual.
 */
export async function appConversorRoutes(app: FastifyInstance) {
  // Entidade do contexto atual — necessária para a barra superior (_navbar).
  const carregarContexto = (req: FastifyRequest) =>
    app.prisma.entidade.findUnique({
      where: { id: req.contexto.entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true } } } } },
    })

  // ── Painel / Selo de Conversão (município do contexto) ──────────────────────
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

  // ── Índice de municípios cadastrados + cadastro de novo ──────────────────────
  app.get('/conversor/config', async (req, reply) => {
    const entidade = await carregarContexto(req)
    if (!entidade) {
      reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      return
    }
    const lista = await listarMunicipios(app.prisma)
    return reply.view('app/conversor-lista', {
      entidade,
      ano: req.contexto.ano,
      lista,
      fabricantes: Object.values(fabricantesConversor),
      tces: Object.keys(fontesExecucao),
      podeEscrever: podeEscrever(req.contexto.nivel),
      aviso: str((req.query as Record<string, unknown>).aviso) || null,
      erro: str((req.query as Record<string, unknown>).erro) || null,
      layout: null,
    })
  })

  app.post('/conversor/config', async (req, reply) => {
    if (!podeEscrever(req.contexto.nivel)) return reply.redirect(`/app/conversor/config?erro=${encodeURIComponent(ERRO_LEITURA)}`)
    const b = req.body as Record<string, unknown>
    const nome = str(b.nome)
    const ibge = str(b.ibge)
    const uf = str(b.uf)
    const ano = Number(str(b.ano))
    const fabricante = str(b.fabricante)
    const tce = str(b.tce)
    if (!nome || !ibge || !uf || !ano || !fabricantesConversor[fabricante] || !fontesExecucao[tce]) {
      return reply.redirect(`/app/conversor/config?erro=${encodeURIComponent('Preencha nome, IBGE, UF, ano e escolha fabricante/TCE válidos.')}`)
    }
    try {
      const { id } = await criarMunicipio(app.prisma, { nome, ibge, uf, ano, fabricante, tce, portalUrl: str(b.portalUrl) })
      return reply.redirect(`/app/conversor/config/${id}?aviso=${encodeURIComponent('Município cadastrado. Adicione as entidades e envie os arquivos.')}`)
    } catch {
      return reply.redirect(`/app/conversor/config?erro=${encodeURIComponent(`Já existe um cadastro para IBGE ${ibge} no ano ${ano}.`)}`)
    }
  })

  // ── Detalhe de um município: entidades + upload + converter ──────────────────
  async function renderDetalhe(reply: FastifyReply, req: FastifyRequest, id: string, flash: { aviso?: string; erro?: string } = {}) {
    const entidade = await carregarContexto(req)
    if (!entidade) {
      reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
      return
    }
    const municipio = await carregarMunicipio(app.prisma, id)
    if (!municipio) return reply.redirect(`/app/conversor/config?erro=${encodeURIComponent('Município não encontrado.')}`)
    const fab = fabricantesConversor[municipio.fabricante]
    return reply.view('app/conversor-config', {
      entidade,
      ano: req.contexto.ano,
      municipio,
      fabricante: fab ?? null,
      camposMunicipio: fab ? fab.campos.filter((c) => c.escopo === 'municipio') : [],
      camposEntidade: fab ? fab.campos.filter((c) => c.escopo === 'entidade') : [],
      tiposEntidade,
      podeEscrever: podeEscrever(req.contexto.nivel),
      rodando: emExecucao.has(id),
      ultimoLog: ultimoLog.get(id) ?? null,
      aviso: flash.aviso ?? str((req.query as Record<string, unknown>).aviso) ?? null,
      erro: flash.erro ?? str((req.query as Record<string, unknown>).erro) ?? null,
      layout: null,
    })
  }

  app.get('/conversor/config/:id', async (req, reply) => {
    return renderDetalhe(reply, req, (req.params as { id: string }).id)
  })

  app.post('/conversor/config/:id/entidade', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!podeEscrever(req.contexto.nivel)) return renderDetalhe(reply, req, id, { erro: ERRO_LEITURA })
    const b = req.body as Record<string, unknown>
    const nome = str(b.nome)
    if (!nome) return renderDetalhe(reply, req, id, { erro: 'Informe o nome da entidade.' })
    const m = await app.prisma.conversorMunicipio.findUnique({ where: { id }, select: { fabricante: true } })
    if (!m) return reply.redirect(`/app/conversor/config?erro=${encodeURIComponent('Município não encontrado.')}`)
    await adicionarEntidade(app.prisma, id, {
      nome,
      tipo: asTipo(b.tipo),
      matchPit: str(b.matchPit),
      params: paramsTextoDoBody(m.fabricante, b),
    })
    return reply.redirect(`/app/conversor/config/${id}?aviso=${encodeURIComponent(`Entidade "${nome}" adicionada.`)}`)
  })

  app.post('/conversor/config/:id/entidade/:eid', async (req, reply) => {
    const { id, eid } = req.params as { id: string; eid: string }
    if (!podeEscrever(req.contexto.nivel)) return renderDetalhe(reply, req, id, { erro: ERRO_LEITURA })
    const b = req.body as Record<string, unknown>
    const nome = str(b.nome)
    if (!nome) return renderDetalhe(reply, req, id, { erro: 'Informe o nome da entidade.' })
    const m = await app.prisma.conversorMunicipio.findUnique({ where: { id }, select: { fabricante: true } })
    await atualizarEntidade(app.prisma, eid, { nome, tipo: asTipo(b.tipo), matchPit: str(b.matchPit) })
    for (const [chave, valor] of Object.entries(paramsTextoDoBody(m?.fabricante ?? '', b))) {
      await definirParamEntidade(app.prisma, eid, chave, valor)
    }
    return reply.redirect(`/app/conversor/config/${id}?aviso=${encodeURIComponent('Entidade atualizada.')}`)
  })

  app.post('/conversor/config/:id/entidade/:eid/remover', async (req, reply) => {
    const { id, eid } = req.params as { id: string; eid: string }
    if (!podeEscrever(req.contexto.nivel)) return renderDetalhe(reply, req, id, { erro: ERRO_LEITURA })
    await removerEntidade(app.prisma, eid)
    return reply.redirect(`/app/conversor/config/${id}?aviso=${encodeURIComponent('Entidade removida.')}`)
  })

  // Upload de um arquivo (multipart). Campos ANTES do arquivo (o <input file> é o
  // último do form): escopo=municipio|entidade, entidadeId?, chave.
  app.post('/conversor/config/:id/upload', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!podeEscrever(req.contexto.nivel)) return reply.redirect(`/app/conversor/config/${id}?erro=${encodeURIComponent(ERRO_LEITURA)}`)
    const municipio = await carregarMunicipio(app.prisma, id)
    if (!municipio) return reply.redirect(`/app/conversor/config?erro=${encodeURIComponent('Município não encontrado.')}`)

    const campos: Record<string, string> = {}
    let salvo: { escopo: string; entidadeId: string; chave: string; caminho: string } | null = null
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const chave = campos['chave'] ?? ''
        const escopo = campos['escopo'] === 'municipio' ? 'municipio' : 'entidade'
        if (!chave || !part.filename) {
          part.file.resume() // descarta o stream se faltou contexto ou arquivo
          continue
        }
        const alvoId = escopo === 'municipio' ? municipio.id : campos['entidadeId'] ?? ''
        const nome = nomeArquivo(escopo, alvoId, chave, part.filename)
        const caminho = await salvarUpload(municipio.ibge, nome, part.file)
        salvo = { escopo, entidadeId: campos['entidadeId'] ?? '', chave, caminho }
      } else {
        campos[part.fieldname] = String(part.value)
      }
    }

    if (!salvo) return reply.redirect(`/app/conversor/config/${id}?erro=${encodeURIComponent('Nenhum arquivo enviado.')}`)
    if (salvo.escopo === 'municipio') await definirParamMunicipio(app.prisma, id, salvo.chave, salvo.caminho)
    else if (salvo.entidadeId) await definirParamEntidade(app.prisma, salvo.entidadeId, salvo.chave, salvo.caminho)
    return reply.redirect(`/app/conversor/config/${id}?aviso=${encodeURIComponent('Arquivo enviado.')}`)
  })

  // ── Converter: roda o pipeline e escreve na base (assíncrono) ────────────────
  app.post('/conversor/config/:id/converter', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!podeEscrever(req.contexto.nivel)) return renderDetalhe(reply, req, id, { erro: ERRO_LEITURA })
    if (emExecucao.has(id)) return renderDetalhe(reply, req, id, { aviso: 'Já há uma conversão em andamento — atualize a página para ver o resultado.' })

    const cfg = await carregarConfig(app.prisma, id)
    if (!cfg) return reply.redirect(`/app/conversor/config?erro=${encodeURIComponent('Município não encontrado.')}`)
    if (!cfg.entidades.length) return renderDetalhe(reply, req, id, { erro: 'Cadastre ao menos uma entidade antes de converter.' })

    emExecucao.add(id)
    const linhas: string[] = []
    void (async () => {
      try {
        await importarMunicipio(app.prisma, cfg, (m) => linhas.push(m))
        ultimoLog.set(id, { quando: new Date(), linhas, erro: null })
      } catch (e) {
        req.log.error(e, '[conversor] falha ao converter')
        ultimoLog.set(id, { quando: new Date(), linhas, erro: (e as Error).message })
      } finally {
        emExecucao.delete(id)
      }
    })()
    return renderDetalhe(reply, req, id, {
      aviso: 'Conversão iniciada — lê os arquivos e escreve o orçamentário + execução na base. Atualize a página para ver o resultado.',
    })
  })
}
