import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appRgfRoutes } from '../rgf.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'
import { Prisma } from '@prisma/client'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)
const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Maringá', estado: { sigla: 'PR', nome: 'Paraná' } } }
const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
const POST = (url: string, body: Record<string, string>) => ({ method: 'POST' as const, url, payload: form(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } })

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appRgfRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appRgfRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  it('GET mostra as três seções com estados vazios funcionais', async () => {
    const res = await app.inject({ method: 'GET', url: '/orcamento/rgf/cadastros' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Dívida Consolidada (Anexo 2)')
    expect(res.body).toContain('Garantias concedidas (Anexo 3)')
    expect(res.body).toContain('Operações de crédito (Anexo 4)')
    expect(res.body).toContain('dívida zerada')
  })

  it('GET lista itens cadastrados com totais', async () => {
    prisma.dividaItem.findMany.mockResolvedValue([
      { id: 'd1', categoria: 'CONTRATUAL', descricao: 'Financiamento CAIXA', valorSaldo: dec(500000000), criadoEm: new Date() },
    ])
    const res = await app.inject({ method: 'GET', url: '/orcamento/rgf/cadastros' })
    expect(res.body).toContain('Financiamento CAIXA')
    expect(res.body).toContain('500.000.000,00')
  })

  it('POST cria item da dívida e reexibe com aviso', async () => {
    prisma.dividaItem.create.mockResolvedValue({})
    const res = await app.inject(POST('/orcamento/rgf/cadastros/divida', { categoria: 'PRECATORIOS', descricao: 'Precatórios TJ-PR', valorSaldo: '44,32' }))
    expect(res.statusCode).toBe(200)
    expect(prisma.dividaItem.create).toHaveBeenCalledWith({
      data: { entidadeId: 'ent1', ano: 2026, categoria: 'PRECATORIOS', descricao: 'Precatórios TJ-PR', valorSaldo: 44.32 },
    })
    expect(res.body).toContain('registrado')
  })

  it('POST inválido volta 400 com a mensagem do negócio', async () => {
    const res = await app.inject(POST('/orcamento/rgf/cadastros/divida', { categoria: 'X', descricao: 'd', valorSaldo: '1' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('Categoria de dívida inválida')
  })

  it('LEITURA não pode escrever (403)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject(POST('/orcamento/rgf/cadastros/garantia', { tipo: 'INTERNA', beneficiario: 'X', valor: '1' }))
    expect(res.statusCode).toBe(403)
    expect(prisma.garantia.create).not.toHaveBeenCalled()
  })

  it('POST excluir de outra entidade → 404 do negócio vira 400 com mensagem', async () => {
    prisma.garantia.findUnique.mockResolvedValue({ entidadeId: 'OUTRA' })
    const res = await app.inject(POST('/orcamento/rgf/cadastros/garantia/excluir', { id: 'g1' }))
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('não encontrada')
  })
})
