import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, criarMock, confirmarMock, cancelarMock } = vi.hoisted(() => ({ listarMock: vi.fn(), criarMock: vi.fn(), confirmarMock: vi.fn(), cancelarMock: vi.fn() }))

vi.mock('../../services/ordens-pagamento.js', () => ({
  OrdensPagamentoService: class {
    listar = listarMock
    criar = criarMock
    confirmarPagamento = confirmarMock
    cancelar = cancelarMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminOrdensPagamentoRoutes } from '../ordens-pagamento.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Pref', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }
const OP = {
  id: 'op1', numero: 'OP-001', valor: '200', contaBancaria: 'BB 1234-5', status: 'EMITIDA',
  liquidacao: { numero: 'LIQ-001', empenho: { numero: '2026NE001' } },
}

function form(obj: Record<string, string>) {
  return { payload: new URLSearchParams(obj).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('adminOrdensPagamentoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    ;[listarMock, criarMock, confirmarMock, cancelarMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({ registrar: adminOrdensPagamentoRoutes, comView: true, simularAdmin: { sub: 'a1', email: 'a@x.com' } }))
  })

  it('GET / lista por entidade', async () => {
    prisma.estado.findMany.mockResolvedValue([])
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    listarMock.mockResolvedValue([OP])
    const res = await app.inject({ method: 'GET', url: '/?estadoId=e&municipioId=m&entidadeId=ent1' })
    expect(listarMock).toHaveBeenCalledWith('ent1')
    expect(res.body).toContain('OP-001')
    expect(res.body).toContain('Emitida')
  })

  const LIQ = {
    id: 'l1', numero: 'LIQ-001', valor: '300', valorPago: '100',
    empenho: { numero: '2026NE001', dotacaoDespesa: { fonteRecurso: { codigo: '500', nomenclatura: 'Livres' } } },
  }
  const CONTA = { id: 'cb1', entidadeId: 'ent1', fonteCodigo: '500', ativa: true, bancoCodigo: '104', agencia: '0394', agenciaDv: null, numero: '123456', numeroDv: '7', descricao: null }

  it('GET /form renderiza com liquidações (fonte embutida) e contas da entidade', async () => {
    prisma.liquidacao.findMany.mockResolvedValue([LIQ])
    prisma.contaBancaria.findMany.mockResolvedValue([CONTA])
    const res = await app.inject({ method: 'GET', url: '/form?entidadeId=ent1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Nova Ordem de Pagamento')
    expect(res.body).toContain('200.00') // saldo 300-100
    expect(res.body).toContain('data-fonte="500"') // fonte da liquidação p/ o filtro
    expect(res.body).toContain('"fonteCodigo":"500"') // JSON das contas p/ o select
    expect(res.body).toContain('name="contaBancariaId"')
    expect(res.body).not.toContain('name="contaBancaria"') // texto livre saiu
  })

  it('POST / cria com contaBancariaId (data e comprovante opcionais repassados)', async () => {
    criarMock.mockResolvedValue({ id: 'op1' })
    const res = await app.inject({ method: 'POST', url: '/', ...form({ entidadeId: 'ent1', liquidacaoId: 'l1', numero: 'OP-001', valor: '200', contaBancariaId: 'cb1', data: '2026-06-12', comprovante: 'TED-1' }) })
    expect(res.statusCode).toBe(204)
    expect(criarMock.mock.calls[0][1]).toMatchObject({ liquidacaoId: 'l1', numero: 'OP-001', valor: '200', contaBancariaId: 'cb1', data: '2026-06-12', comprovante: 'TED-1' })
  })

  it('POST / com erro re-renderiza o form preservando a conta escolhida', async () => {
    criarMock.mockRejectedValue(new Error('Pagamentos da fonte 500 só podem sair de contas vinculadas a ela'))
    prisma.liquidacao.findMany.mockResolvedValue([LIQ])
    prisma.contaBancaria.findMany.mockResolvedValue([CONTA])
    const res = await app.inject({ method: 'POST', url: '/', ...form({ entidadeId: 'ent1', liquidacaoId: 'l1', numero: 'OP-001', valor: '200', contaBancariaId: 'cb1' }) })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Pagamentos da fonte 500')
    expect(res.body).toContain('"cb1"') // CONTA_SALVA p/ o JS restaurar a seleção
  })

  it('POST /:id/confirmar', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    confirmarMock.mockResolvedValue({ id: 'op1' })
    const res = await app.inject({ method: 'POST', url: '/op1/confirmar', ...form({ comprovante: 'TED-9' }) })
    expect(res.statusCode).toBe(204)
    expect(confirmarMock).toHaveBeenCalledWith('op1', 'TED-9')
  })

  it('POST /:id/cancelar', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    cancelarMock.mockResolvedValue({ id: 'op1' })
    const res = await app.inject({ method: 'POST', url: '/op1/cancelar' })
    expect(res.statusCode).toBe(204)
    expect(cancelarMock).toHaveBeenCalledWith('op1')
  })

  it('GET / sem entidade selecionada não lista; GET /form e POST / sem entidadeId → 400', async () => {
    prisma.estado.findMany.mockResolvedValue([])
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200)
    expect(listarMock).not.toHaveBeenCalled()
    expect((await app.inject({ method: 'GET', url: '/form' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/', ...form({ numero: 'OP-1' }) })).statusCode).toBe(400)
  })

  it('confirmar/cancelar: OP inexistente → 404; erro do service → 400 com a mensagem', async () => {
    prisma.ordemPagamento.findUnique.mockResolvedValue(null)
    expect((await app.inject({ method: 'POST', url: '/x/confirmar', ...form({}) })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/x/cancelar' })).statusCode).toBe(404)

    prisma.ordemPagamento.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    confirmarMock.mockRejectedValue(new Error('Apenas OP EMITIDA pode ser confirmada.'))
    const rc = await app.inject({ method: 'POST', url: '/op1/confirmar', ...form({}) })
    expect(rc.statusCode).toBe(400)
    expect(rc.body).toContain('EMITIDA')
    cancelarMock.mockRejectedValue(new Error('OP já está cancelada.'))
    const rx = await app.inject({ method: 'POST', url: '/op1/cancelar' })
    expect(rx.statusCode).toBe(400)
    expect(rx.body).toContain('cancelada')
  })

  it('erros não-Error viram mensagem genérica (emitir/confirmar/cancelar)', async () => {
    prisma.liquidacao.findMany.mockResolvedValue([])
    prisma.contaBancaria.findMany.mockResolvedValue([])
    criarMock.mockRejectedValue('string-erro')
    const re = await app.inject({ method: 'POST', url: '/', ...form({ entidadeId: 'ent1', liquidacaoId: 'l1', numero: 'OP-1', valor: '1', contaBancariaId: 'cb1' }) })
    expect(re.body).toContain('Erro ao emitir OP.')

    prisma.ordemPagamento.findUnique.mockResolvedValue({ entidadeId: 'ent1' })
    confirmarMock.mockRejectedValue('x')
    expect((await app.inject({ method: 'POST', url: '/op1/confirmar', ...form({}) })).body).toContain('Erro ao confirmar.')
    cancelarMock.mockRejectedValue('x')
    expect((await app.inject({ method: 'POST', url: '/op1/cancelar' })).body).toContain('Erro ao cancelar.')
  })
})
