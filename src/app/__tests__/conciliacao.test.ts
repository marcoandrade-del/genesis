import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({
  painel: vi.fn(),
  importar: vi.fn(),
  registrarManual: vi.fn(),
  sugerir: vi.fn(),
  conciliar: vi.fn(),
  desconciliar: vi.fn(),
  excluir: vi.fn(),
  listar: vi.fn(),
}))

vi.mock('../../services/conciliacao-bancaria.js', () => ({
  ConciliacaoBancariaService: class {
    painel = m.painel
    importar = m.importar
    registrarManual = m.registrarManual
    sugerir = m.sugerir
    conciliar = m.conciliar
    desconciliar = m.desconciliar
    excluirMovimento = m.excluir
  },
}))
vi.mock('../../services/contas-bancarias.js', () => ({
  ContasBancariasService: class {
    listar = m.listar
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appConciliacaoRoutes } from '../conciliacao.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Maringá', estado: { sigla: 'PR', nome: 'Paraná' } } }
const CONTA = { id: 'cb1', fonteCodigo: '1000', ativa: true, rotulo: '104 ag. 0394 c/c 123' }
const PAINEL = {
  conta: { ...CONTA },
  conciliados: [],
  extratoPendente: [{ id: 'm1', data: '2026-06-01T00:00:00Z', valor: '100', historico: 'FPM', origemImport: 'OFX' }],
  arrecadacoesPendentes: [{ id: 'a1', data: '2026-06-01T00:00:00Z', valor: '100', previsao: { contaReceita: { codigo: '1.7', descricao: 'FPM' }, fonteRecurso: { codigo: '1000' } } }],
  totais: { extrato: 100, arrecadado: 100, conciliado: 0, diferenca: 0, pendentesExtrato: 1, pendentesArrecadacao: 1 },
}
const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
const POST = (url: string, body: Record<string, string>) => ({ method: 'POST' as const, url, payload: form(body), headers: { 'content-type': 'application/x-www-form-urlencoded' } })

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appConciliacaoRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appConciliacaoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    Object.values(m).forEach((fn) => fn.mockReset())
    m.listar.mockResolvedValue([CONTA])
    m.painel.mockResolvedValue(PAINEL)
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  it('GET sem conta mostra o seletor (sem painel)', async () => {
    const res = await app.inject({ method: 'GET', url: '/orcamento/conciliacao' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Conciliação bancária')
    expect(m.painel).not.toHaveBeenCalled()
  })

  it('GET ?conta carrega o painel', async () => {
    const res = await app.inject({ method: 'GET', url: '/orcamento/conciliacao?conta=cb1' })
    expect(res.statusCode).toBe(200)
    expect(m.painel).toHaveBeenCalledWith('cb1', 'ent1', 2026)
    expect(res.body).toContain('Extrato pendente')
    expect(res.body).toContain('1.7') // arrecadação pendente no select
  })

  it('POST importar chama o serviço e volta para a conta', async () => {
    const res = await app.inject(POST('/orcamento/conciliacao/importar', { contaBancariaId: 'cb1', formato: 'OFX', conteudo: '<STMTTRN>...' }))
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/orcamento/conciliacao?conta=cb1')
    expect(m.importar).toHaveBeenCalledWith('cb1', 'ent1', 'OFX', '<STMTTRN>...')
  })

  it('POST conciliar chama o serviço', async () => {
    const res = await app.inject(POST('/orcamento/conciliacao/conciliar', { contaBancariaId: 'cb1', movimentoId: 'm1', arrecadacaoId: 'a1' }))
    expect(res.statusCode).toBe(302)
    expect(m.conciliar).toHaveBeenCalledWith('m1', 'a1', 'ent1')
  })

  it('POST sugerir chama o auto-conciliar', async () => {
    const res = await app.inject(POST('/orcamento/conciliacao/sugerir', { contaBancariaId: 'cb1' }))
    expect(res.statusCode).toBe(302)
    expect(m.sugerir).toHaveBeenCalledWith('cb1', 'ent1', 2026)
  })

  it('LEITURA não pode importar (403)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject(POST('/orcamento/conciliacao/importar', { contaBancariaId: 'cb1', formato: 'OFX', conteudo: 'x' }))
    expect(res.statusCode).toBe(403)
    expect(m.importar).not.toHaveBeenCalled()
  })
})
