import { describe, it, expect, beforeEach, vi } from 'vitest'

const a = vi.hoisted(() => ({ contabilizar: vi.fn(), estornar: vi.fn(), status: vi.fn() }))
vi.mock('../../services/abertura-contabil.js', () => ({
  AberturaContabilService: class {
    contabilizar = a.contabilizar
    estornar = a.estornar
    status = a.status
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appOrcamentoRoutes } from '../orcamento.js'
import { ErroNegocio } from '../../errors.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }

async function montar(nivel: 'LEITURA' | 'ESCRITA' | 'ADMIN' = 'ESCRITA') {
  return criarApp({
    registrar: appOrcamentoRoutes,
    comView: true,
    simularUsuario: { sub: 'u1', email: 'u@x.com' },
    simularContexto: { entidadeId: 'ent1', ano: 2026, nivel },
  })
}

describe('appOrcamentoRoutes — abertura PCASP', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    a.contabilizar.mockReset().mockResolvedValue({ previsoes: 3, dotacoes: 5, totalPrevisto: '100.00', totalFixado: '100.00', contasTransportadas: 0 })
    a.estornar.mockReset().mockResolvedValue(undefined)
    a.status.mockReset().mockResolvedValue({ orcamentoId: 'o', status: 'APROVADO', contabilizada: false, podeContabilizar: true, podeEstornar: false, temExecucao: false })
    ;({ app, prisma } = await montar())
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  })

  it('contabiliza a abertura (ESCRITA) e mostra o resumo', async () => {
    a.status.mockResolvedValue({ orcamentoId: 'o', status: 'EM_EXECUCAO', contabilizada: true, podeContabilizar: false, podeEstornar: true, temExecucao: false })
    const res = await app.inject({ method: 'POST', url: '/orcamento/abertura/contabilizar' })
    expect(res.statusCode).toBe(200)
    expect(a.contabilizar).toHaveBeenCalledWith('ent1', 2026, 'u1')
    expect(res.body).toContain('Abertura contabilizada')
  })

  it('LEITURA não pode contabilizar (403) e não chama o serviço', async () => {
    ;({ app, prisma } = await montar('LEITURA'))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject({ method: 'POST', url: '/orcamento/abertura/contabilizar' })
    expect(res.statusCode).toBe(403)
    expect(a.contabilizar).not.toHaveBeenCalled()
  })

  it('propaga ErroNegocio do serviço com o status certo', async () => {
    a.contabilizar.mockRejectedValue(new ErroNegocio('CONFLITO', 'A LOA ainda está em rascunho.'))
    const res = await app.inject({ method: 'POST', url: '/orcamento/abertura/contabilizar' })
    expect(res.statusCode).toBe(409)
    expect(res.body).toContain('rascunho')
  })

  it('estorna a abertura (ESCRITA)', async () => {
    const res = await app.inject({ method: 'POST', url: '/orcamento/abertura/estornar' })
    expect(res.statusCode).toBe(200)
    expect(a.estornar).toHaveBeenCalledWith('ent1', 2026)
    expect(res.body).toContain('estornada')
  })
})
