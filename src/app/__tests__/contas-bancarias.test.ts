import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({
  listar: vi.fn(),
  listarFontes: vi.fn(),
  criar: vi.fn(),
  atualizar: vi.fn(),
  alternarAtiva: vi.fn(),
  excluir: vi.fn(),
}))

vi.mock('../../services/contas-bancarias.js', () => ({
  ContasBancariasService: class {
    listar = m.listar
    listarFontes = m.listarFontes
    criar = m.criar
    atualizar = m.atualizar
    alternarAtiva = m.alternarAtiva
    excluir = m.excluir
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appContasBancariasRoutes } from '../contas-bancarias.js'
import { ErroNegocio } from '../../errors.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const CONTA = {
  id: 'cb1', entidadeId: 'ent1', fonteCodigo: '500', fonteNomenclatura: 'Recursos Livres',
  bancoCodigo: '104', bancoNome: 'Caixa', agencia: '0394', agenciaDv: null, numero: '123456', numeroDv: '7',
  descricao: 'Movimento', ativa: true, rotulo: '104 ag. 0394 c/c 123456-7 — Movimento',
}
const FONTES = [{ codigo: '500', nomenclatura: 'Recursos Livres' }]
const DADOS = { fonteCodigo: '500', bancoCodigo: '104', bancoNome: 'Caixa', agencia: '0394', agenciaDv: '', numero: '123456', numeroDv: '7', descricao: 'Movimento' }

const form = (o: Record<string, string>) =>
  Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
const POST = (url: string, body: Record<string, string>) => ({
  method: 'POST' as const,
  url,
  payload: form(body),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
})

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appContasBancariasRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appContasBancariasRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    Object.values(m).forEach((fn) => fn.mockReset())
    m.listar.mockResolvedValue([CONTA])
    m.listarFontes.mockResolvedValue(FONTES)
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  it('GET lista contas com fonte, rótulo Febraban e form (ESCRITA)', async () => {
    const res = await app.inject({ method: 'GET', url: '/contas-bancarias' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Recursos Livres')
    expect(res.body).toContain('0394')
    expect(res.body).toContain('123456-7')
    expect(res.body).toContain('Nova conta')
    expect(res.body).toContain('500 — Recursos Livres') // select de fontes do exercício
  })

  it('GET para LEITURA não mostra o form nem ações', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject({ method: 'GET', url: '/contas-bancarias' })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('Nova conta')
    expect(res.body).not.toContain('Excluir')
  })

  it('GET aponta fonte fora do exercício', async () => {
    m.listar.mockResolvedValue([{ ...CONTA, fonteNomenclatura: null }])
    const res = await app.inject({ method: 'GET', url: '/contas-bancarias' })
    expect(res.body).toContain('fonte fora do exercício 2026')
  })

  it('GET ?editar preenche o form com a conta', async () => {
    const res = await app.inject({ method: 'GET', url: '/contas-bancarias?editar=cb1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Editar conta')
    expect(res.body).toContain('action="/app/contas-bancarias/cb1"')
  })

  it('GET ?editar com id desconhecido cai na tela normal', async () => {
    const res = await app.inject({ method: 'GET', url: '/contas-bancarias?editar=nao-existe' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Nova conta')
  })

  it('GET redireciona se entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'GET', url: '/contas-bancarias' })).statusCode).toBe(302)
  })

  it('POST cria e redireciona', async () => {
    m.criar.mockResolvedValue(CONTA)
    const res = await app.inject(POST('/contas-bancarias', DADOS))
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contas-bancarias')
    expect(m.criar).toHaveBeenCalledWith('ent1', 2026, DADOS)
  })

  it('POST com ErroNegocio re-renderiza com os valores digitados', async () => {
    m.criar.mockRejectedValue(new ErroNegocio('REQUISICAO_INVALIDA', 'Código do banco deve ter 3 dígitos (padrão Febraban, ex.: 001, 104, 341).'))
    const res = await app.inject(POST('/contas-bancarias', { ...DADOS, bancoCodigo: '1' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('3 dígitos')
    expect(res.body).toContain('value="123456"') // valores preservados no form
  })

  it('POST bloqueado para LEITURA', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject(POST('/contas-bancarias', DADOS))
    expect(res.statusCode).toBe(403)
    expect(m.criar).not.toHaveBeenCalled()
  })

  it('POST redireciona se entidade sumiu; propaga erro inesperado', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect((await app.inject(POST('/contas-bancarias', DADOS))).statusCode).toBe(302)
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    m.criar.mockRejectedValue(new Error('boom'))
    expect((await app.inject(POST('/contas-bancarias', DADOS))).statusCode).toBe(500)
  })

  it('POST /:id atualiza; erro mantém modo edição', async () => {
    m.atualizar.mockResolvedValue(CONTA)
    let res = await app.inject(POST('/contas-bancarias/cb1', DADOS))
    expect(res.statusCode).toBe(302)
    expect(m.atualizar).toHaveBeenCalledWith('cb1', 'ent1', 2026, DADOS)

    m.atualizar.mockRejectedValue(new ErroNegocio('CONFLITO', 'Já existe a conta 104 ag. 0394 nº 123456 nesta entidade.'))
    res = await app.inject(POST('/contas-bancarias/cb1', DADOS))
    expect(res.statusCode).toBe(409)
    expect(res.body).toContain('Editar conta')
  })

  it('POST /:id/alternar e /:id/excluir delegam ao service', async () => {
    m.alternarAtiva.mockResolvedValue(CONTA)
    expect((await app.inject(POST('/contas-bancarias/cb1/alternar', {}))).statusCode).toBe(302)
    expect(m.alternarAtiva).toHaveBeenCalledWith('cb1', 'ent1')

    m.excluir.mockResolvedValue(CONTA)
    expect((await app.inject(POST('/contas-bancarias/cb1/excluir', {}))).statusCode).toBe(302)
    expect(m.excluir).toHaveBeenCalledWith('cb1', 'ent1')
  })

  it('POST sem corpo chama criar com campos vazios', async () => {
    m.criar.mockResolvedValue(CONTA)
    const res = await app.inject({ method: 'POST', url: '/contas-bancarias', payload: '', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(res.statusCode).toBe(302)
    expect(m.criar).toHaveBeenCalledWith('ent1', 2026, {
      fonteCodigo: '', bancoCodigo: '', bancoNome: '', agencia: '', agenciaDv: '', numero: '', numeroDv: '', descricao: '',
    })
  })

  it('POST excluir com CONFLITO (conta usada em OP) volta com o erro', async () => {
    m.excluir.mockRejectedValue(new ErroNegocio('CONFLITO', 'Esta conta já foi usada em 2 ordem(ns) de pagamento — inative-a em vez de excluir.'))
    const res = await app.inject(POST('/contas-bancarias/cb1/excluir', {}))
    expect(res.statusCode).toBe(409)
    expect(res.body).toContain('inative-a em vez de excluir')
  })
})
