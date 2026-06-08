import type { FastifyInstance } from 'fastify'
import type { TipoEntidade } from '@prisma/client'
import { EntidadeService, type DadosAtualizarEntidade } from '../services/entidades.js'

const TIPOS: TipoEntidade[] = ['PREFEITURA', 'CAMARA', 'ADM_INDIRETA']
const ehTipo = (v: string): v is TipoEntidade => (TIPOS as string[]).includes(v)

// O brasão chega como data URL base64 vinda do FileReader no formulário. O
// cliente já limita o arquivo a 1 MB (~1,4 MB em base64); estes limites são a
// rede de segurança do servidor. BODY_BRASAO (corpo total) folga acima do
// MAX_BRASAO (comprimento do data URL) para o 413 nunca disparar antes da
// validação amigável.
const MAX_BRASAO = 1.5 * 1024 * 1024
const BODY_BRASAO = 2 * 1024 * 1024
const RE_BRASAO = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/

/**
 * Valida o brasão recebido do formulário. `''` significa "sem brasão / remover"
 * (→ null); um data URL de imagem raster é aceito; qualquer outra coisa é erro.
 */
function validarBrasao(v: string): { ok: true; valor: string | null } | { ok: false; erro: string } {
  const s = v.trim()
  if (s === '') return { ok: true, valor: null }
  if (s.length > MAX_BRASAO) return { ok: false, erro: 'Imagem muito grande (máx. 1 MB). Use um arquivo menor.' }
  if (!RE_BRASAO.test(s)) return { ok: false, erro: 'Brasão inválido — envie uma imagem PNG, JPG, GIF ou WEBP.' }
  return { ok: true, valor: s }
}

export async function adminEntidadesRoutes(app: FastifyInstance) {
  const service = new EntidadeService(app.prisma)

  const carregarMunicipios = () =>
    app.prisma.municipio.findMany({
      orderBy: [{ estado: { sigla: 'asc' } }, { nome: 'asc' }],
      include: { estado: { select: { sigla: true } } },
    })

  // ── LIST ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { municipioId?: string } }>('/', async (req, reply) => {
    const municipioId = req.query.municipioId?.trim() || ''
    const [municipios, entidades] = await Promise.all([
      carregarMunicipios(),
      app.prisma.entidade.findMany({
        where: municipioId ? { municipioId } : undefined,
        orderBy: { nome: 'asc' },
        include: { municipio: { include: { estado: { select: { sigla: true } } } } },
      }),
    ])
    return reply.view(
      'entidades/index',
      {
        title: 'Entidades — Gênesis Admin',
        active: 'entidades',
        userEmail: req.user.email,
        municipios,
        entidades,
        municipioSelecionado: municipioId,
      },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM (novo) ─────────────────────────────────────────────────────────────
  app.get('/form', async (_req, reply) => {
    const municipios = await carregarMunicipios()
    return reply.view('entidades/form', { entidade: null, municipios, erro: null })
  })

  // ── FORM (editar) ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: req.params.id },
      include: { municipio: { include: { estado: { select: { sigla: true } } } } },
    })
    if (!entidade) return reply.status(404).send('Entidade não encontrada.')
    return reply.view('entidades/form', { entidade, municipios: [], erro: null })
  })

  // ── CREATE (dispara a cópia do modelo) ──────────────────────────────────────
  app.post<{ Body: { municipioId: string; nome: string; tipo: string; ano: string; cnpj: string; brasao?: string } }>(
    '/',
    { bodyLimit: BODY_BRASAO },
    async (req, reply) => {
      const { municipioId, nome, tipo, ano, cnpj } = req.body
      const reRenderErro = async (erro: string) => {
        const municipios = await carregarMunicipios()
        return reply.view('entidades/form', { entidade: null, municipios, erro })
      }
      if (!municipioId?.trim()) return reRenderErro('Selecione um município.')
      if (!nome?.trim()) return reRenderErro('O nome é obrigatório.')
      if (!ehTipo(tipo)) return reRenderErro('Selecione o tipo da entidade.')
      const anoNum = parseInt(ano, 10)
      if (Number.isNaN(anoNum) || anoNum < 1900 || anoNum > 9999) {
        return reRenderErro('Ano (exercício) inválido.')
      }
      let brasao: string | null | undefined
      if (req.body.brasao !== undefined) {
        const r = validarBrasao(req.body.brasao)
        if (!r.ok) return reRenderErro(r.erro)
        brasao = r.valor
      }
      try {
        await service.criar({
          municipioId,
          nome: nome.trim(),
          tipo,
          ano: anoNum,
          ...(cnpj?.trim() ? { cnpj: cnpj.trim() } : {}),
          ...(brasao !== undefined ? { brasao } : {}),
        })
        return reply.header('HX-Redirect', '/admin/entidades').status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao criar entidade.')
      }
    },
  )

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { nome: string; tipo: string; cnpj: string; ativo?: string; brasao?: string } }>(
    '/:id',
    { bodyLimit: BODY_BRASAO },
    async (req, reply) => {
      const { nome, tipo, cnpj, ativo } = req.body
      const reRenderErro = async (erro: string) => {
        const entidade = await app.prisma.entidade.findUnique({
          where: { id: req.params.id },
          include: { municipio: { include: { estado: { select: { sigla: true } } } } },
        })
        return reply.view('entidades/form', { entidade, municipios: [], erro })
      }
      if (!nome?.trim()) return reRenderErro('O nome é obrigatório.')
      if (!ehTipo(tipo)) return reRenderErro('Tipo inválido.')
      const dados: DadosAtualizarEntidade = {
        nome: nome.trim(),
        tipo,
        cnpj: cnpj?.trim() ? cnpj.trim() : null,
        ativo: ativo === 'true',
      }
      if (req.body.brasao !== undefined) {
        const r = validarBrasao(req.body.brasao)
        if (!r.ok) return reRenderErro(r.erro)
        dados.brasao = r.valor
      }
      try {
        await service.atualizar(req.params.id, dados)
        return reply.header('HX-Redirect', '/admin/entidades').status(204).send()
      } catch (e: unknown) {
        return reRenderErro(e instanceof Error ? e.message : 'Erro ao atualizar entidade.')
      }
    },
  )

  // ── DELETE ──────────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir.'
      return reply.status(400).send(msg)
    }
  })
}
