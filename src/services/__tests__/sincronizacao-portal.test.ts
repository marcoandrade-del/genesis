import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { SincronizacaoPortalService, agendarSincronizacaoPortal } from '../sincronizacao-portal.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

// respostas do portal por URL (ordem: fontes → detalhes → dashboard)
function stubFetch(respostas: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const chave = Object.keys(respostas).find((k) => String(url).includes(k))
      if (!chave) throw new Error(`fetch inesperado: ${url}`)
      return { ok: true, json: async () => respostas[chave] } as Response
    }),
  )
}

describe('SincronizacaoPortalService.arrecadacaoMes', () => {
  let prisma: PrismaMock
  let svc: SincronizacaoPortalService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SincronizacaoPortalService(prisma as never)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { id: 'p1', contaReceita: { codigo: '1.1.1.2.50.0.1' }, fonteRecurso: { codigo: '1000' } },
    ])
    prisma.arrecadacao.groupBy.mockResolvedValue([{ tipo: 'ARRECADACAO', _sum: { valor: dec(100) } }])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('captura, valida contra o dashboard e grava (OK)', async () => {
    stubFetch({
      'fonte-recursos?': [{ receita: '1000' }],
      'fonte-recursos/detalhes': [{ receita: '1.1.1.2.50.0.1', valorArrecadado: 100 }],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 100 }],
    })
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    expect(r.valorGravado).toBe(100)
    expect(prisma.arrecadacao.createMany).toHaveBeenCalled()
    // log persistido
    expect(prisma.sincronizacaoPortal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'ARRECADACAO', status: 'OK', mes: 6 }) }),
    )
  })

  it('divergência acima da tolerância → DIVERGENTE e NÃO grava', async () => {
    stubFetch({
      'fonte-recursos?': [{ receita: '1000' }],
      'fonte-recursos/detalhes': [{ receita: '1.1.1.2.50.0.1', valorArrecadado: 100 }],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 150 }], // 33% off
    })
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('DIVERGENTE')
    expect(prisma.arrecadacao.createMany).not.toHaveBeenCalled()
    expect(prisma.sincronizacaoPortal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DIVERGENTE', valorGravado: 0 }) }),
    )
  })

  it('erro de rede → ERRO logado, nada gravado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response))
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('ERRO')
    expect(prisma.arrecadacao.createMany).not.toHaveBeenCalled()
    expect(prisma.sincronizacaoPortal.create).toHaveBeenCalled()
  })

  it('sem orçamento → ERRO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('ERRO')
    expect(r.mensagem).toContain('orçamento')
  })

  it('só folhas do retorno entram (ancestrais não duplicam)', async () => {
    stubFetch({
      'fonte-recursos?': [{ receita: '1000' }],
      'fonte-recursos/detalhes': [
        { receita: '1.1.1.2.50', valorArrecadado: 100 }, // ancestral — fora
        { receita: '1.1.1.2.50.0.1', valorArrecadado: 100 }, // folha
      ],
      'dashboard/arrecadacao-despesa': [{ mes: 6, valorArrecadado: 100 }],
    })
    const r = await svc.arrecadacaoMes('e1', 2026, 6)
    expect(r.status).toBe('OK')
    expect(r.valorGravado).toBe(100) // não 200
  })
})

describe('agendarSincronizacaoPortal', () => {
  it('desligado sem a env (retorna null, nada agendado)', () => {
    delete process.env['SINCRONIZAR_PORTAL_MARINGA']
    const prisma = criarPrismaMock()
    expect(agendarSincronizacaoPortal(prisma as never, () => {})).toBeNull()
  })

  it('com a env, agenda e retorna o timer', () => {
    process.env['SINCRONIZAR_PORTAL_MARINGA'] = '1'
    vi.useFakeTimers()
    const prisma = criarPrismaMock()
    const timer = agendarSincronizacaoPortal(prisma as never, () => {})
    expect(timer).not.toBeNull()
    clearTimeout(timer!)
    vi.useRealTimers()
    delete process.env['SINCRONIZAR_PORTAL_MARINGA']
  })
})
