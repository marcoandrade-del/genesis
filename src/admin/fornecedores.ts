import type { FastifyInstance } from 'fastify'
import type { TipoPessoa } from '@prisma/client'
import { FornecedoresService } from '../services/fornecedores.js'

const TIPOS: ReadonlyArray<TipoPessoa> = ['PJ', 'PF']

/**
 * Admin de Fornecedores — cadastro global (PJ/PF). CRUD simples com filtro por
 * tipo de pessoa; o documento (CNPJ/CPF) é único conforme o tipo.
 */
export async function adminFornecedoresRoutes(app: FastifyInstance) {
  const service = new FornecedoresService(app.prisma)

  // ── LIST ──────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { tipo?: string } }>('/', async (req, reply) => {
    const tipoFiltro = TIPOS.includes(req.query.tipo as TipoPessoa) ? (req.query.tipo as TipoPessoa) : ''
    const items = await service.listar(tipoFiltro ? { tipoPessoa: tipoFiltro } : {})
    return reply.view(
      'fornecedores/index',
      { title: 'Fornecedores — Gênesis Admin', active: 'fornecedores', userEmail: req.user.email, items, tipoFiltro },
      { layout: 'layouts/main' },
    )
  })

  // ── FORM ────────────────────────────────────────────────────────────────────
  app.get('/form', async (_req, reply) => {
    return reply.view('fornecedores/form', { item: null, erro: null })
  })

  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const item = await service.buscarPorId(req.params.id)
    if (!item) return reply.status(404).send('Fornecedor não encontrado.')
    return reply.view('fornecedores/form', { item, erro: null })
  })

  // ── CREATE ────────────────────────────────────────────────────────────────
  app.post<{
    Body: { tipoPessoa: string; cnpj?: string; cpf?: string; razaoSocial: string; nomeFantasia?: string; email?: string; telefone?: string }
  }>('/', async (req, reply) => {
    const b = req.body
    try {
      await service.criar({
        tipoPessoa: b.tipoPessoa as TipoPessoa,
        cnpj: b.cnpj,
        cpf: b.cpf,
        razaoSocial: b.razaoSocial,
        nomeFantasia: b.nomeFantasia,
        email: b.email,
        telefone: b.telefone,
      })
      return reply.header('HX-Redirect', '/admin/fornecedores').status(204).send()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar fornecedor.'
      return reply.view('fornecedores/form', { item: b, erro: msg })
    }
  })

  // ── UPDATE ────────────────────────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: { tipoPessoa: string; cnpj?: string; cpf?: string; razaoSocial: string; nomeFantasia?: string; email?: string; telefone?: string; ativo?: string }
  }>('/:id', async (req, reply) => {
    const b = req.body
    try {
      await service.atualizar(req.params.id, {
        tipoPessoa: b.tipoPessoa as TipoPessoa,
        cnpj: b.cnpj,
        cpf: b.cpf,
        razaoSocial: b.razaoSocial,
        nomeFantasia: b.nomeFantasia,
        email: b.email,
        telefone: b.telefone,
        ativo: b.ativo === 'true',
      })
      return reply.header('HX-Redirect', '/admin/fornecedores').status(204).send()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar fornecedor.'
      return reply.view('fornecedores/form', { item: { id: req.params.id, ...b, ativo: b.ativo === 'true' }, erro: msg })
    }
  })

  // ── DELETE ────────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      await service.excluir(req.params.id)
      return reply.status(200).send('')
    } catch (e: unknown) {
      return reply.status(400).send(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  })
}
