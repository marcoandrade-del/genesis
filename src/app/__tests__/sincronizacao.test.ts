import { describe, it, expect, beforeEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ arrecadacaoMes: vi.fn(), despesaMes: vi.fn() }))
vi.mock('../../services/sincronizacao-portal.js', () => ({
  SincronizacaoPortalService: class {
    arrecadacaoMes = m.arrecadacaoMes
    despesaMes = m.despesaMes
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appSincronizacaoRoutes } from '../sincronizacao.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Maringá', estado: { sigla: 'PR', nome: 'Paraná' } } }
const POST = { method: 'POST' as const, url: '/sincronizacao/rodar', payload: '', headers: { 'content-type': 'application/x-www-form-urlencoded' } }

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }) {
  return criarApp({ registrar: appSincronizacaoRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appSincronizacaoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  beforeEach(async () => {
    m.arrecadacaoMes.mockReset().mockResolvedValue({ status: 'OK' })
    m.despesaMes.mockReset().mockResolvedValue({ status: 'OK' })
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  it('GET mostra o botão e o estado do agendamento', async () => {
    const res = await app.inject({ method: 'GET', url: '/sincronizacao' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Sincronizar agora')
    expect(res.body).toContain('Agendamento diário')
    expect(res.body).toContain('Nenhuma sincronização registrada')
  })

  it('GET lista as execuções do log com status e valores', async () => {
    prisma.sincronizacaoPortal.findMany.mockResolvedValue([
      { tipo: 'ARRECADACAO', ano: 2026, mes: 7, status: 'OK', mensagem: '58 movimentos', valorPortal: 3955108.15, valorGravado: 3955108.15, criadoEm: new Date('2026-07-06T04:00:00Z') },
      { tipo: 'DESPESA_EXECUCAO', ano: 2026, mes: 7, status: 'DIVERGENTE', mensagem: 'divergência 1,2%', valorPortal: 100, valorGravado: null, criadoEm: new Date('2026-07-06T04:05:00Z') },
    ])
    const res = await app.inject({ method: 'GET', url: '/sincronizacao' })
    expect(res.body).toContain('Receita (arrecadação)')
    expect(res.body).toContain('Despesa (execução)')
    expect(res.body).toContain('DIVERGENTE')
    expect(res.body).toContain('07/2026')
    expect(res.body).toContain('58 movimentos')
  })

  it('POST dispara receita antes da despesa e avisa que iniciou', async () => {
    const ordem: string[] = []
    m.arrecadacaoMes.mockImplementation(async () => { ordem.push('receita'); return { status: 'OK' } })
    m.despesaMes.mockImplementation(async () => { ordem.push('despesa'); return { status: 'OK' } })
    const res = await app.inject(POST)
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Sincronização de')
    expect(res.body).toContain('iniciada')
    await vi.waitFor(() => expect(ordem).toEqual(['receita', 'despesa']))
    const agora = new Date()
    expect(m.arrecadacaoMes).toHaveBeenCalledWith('ent1', agora.getFullYear(), agora.getMonth() + 1)
    expect(m.despesaMes).toHaveBeenCalledWith('ent1', agora.getFullYear(), agora.getMonth() + 1)
  })

  it('LEITURA não pode disparar (403)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject(POST)
    expect(res.statusCode).toBe(403)
    expect(m.arrecadacaoMes).not.toHaveBeenCalled()
  })

  it('segunda execução simultânea é recusada (409)', async () => {
    // entidade própria para não travar as demais (o lock é por entidade, em módulo)
    ;({ app, prisma } = await montar({ entidadeId: 'ent-lock', ano: 2026, nivel: 'ADMIN' }))
    prisma.entidade.findUnique.mockResolvedValue({ ...ENTIDADE, id: 'ent-lock' })
    let liberar!: () => void
    m.arrecadacaoMes.mockImplementation(() => new Promise<void>((res) => { liberar = res }))
    const r1 = await app.inject(POST)
    expect(r1.statusCode).toBe(200)
    const r2 = await app.inject(POST)
    expect(r2.statusCode).toBe(409)
    expect(r2.body).toContain('em andamento')
    liberar()
    await vi.waitFor(() => expect(m.despesaMes).toHaveBeenCalled())
  })

  it('falha na sincronização libera o lock (não trava o botão)', async () => {
    m.arrecadacaoMes.mockRejectedValue(new Error('portal fora do ar'))
    const r1 = await app.inject(POST)
    expect(r1.statusCode).toBe(200)
    await vi.waitFor(async () => {
      const r2 = await app.inject(POST)
      expect(r2.statusCode).toBe(200) // lock liberado — aceita de novo
    })
  })
})
