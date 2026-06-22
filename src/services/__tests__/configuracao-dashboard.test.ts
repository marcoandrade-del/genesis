import { describe, it, expect, beforeEach } from 'vitest'
import { ConfiguracaoDashboardService, aplicarGranularidade } from '../configuracao-dashboard.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

describe('aplicarGranularidade', () => {
  const itens = [
    { id: 'a', origem: 'MODELO' },
    { id: 'b', origem: 'DESDOBRAMENTO' },
    { id: 'c', origem: 'MODELO' },
  ]
  it('PADRAO remove as linhas de desdobramento local', () => {
    expect(aplicarGranularidade(itens, 'PADRAO').map((i) => i.id)).toEqual(['a', 'c'])
  })
  it('DESDOBRADO mantém tudo', () => {
    expect(aplicarGranularidade(itens, 'DESDOBRADO')).toHaveLength(3)
  })
})

describe('ConfiguracaoDashboardService', () => {
  let prisma: PrismaMock
  let svc: ConfiguracaoDashboardService
  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new ConfiguracaoDashboardService(prisma as never)
  })

  it('granularidade devolve DESDOBRADO quando não há config', async () => {
    prisma.configuracaoDashboard.findUnique.mockResolvedValue(null)
    expect(await svc.granularidade('ent1')).toBe('DESDOBRADO')
  })

  it('granularidade devolve o valor configurado', async () => {
    prisma.configuracaoDashboard.findUnique.mockResolvedValue({ granularidadePlano: 'PADRAO' })
    expect(await svc.granularidade('ent1')).toBe('PADRAO')
  })

  it('definir faz upsert por entidade', async () => {
    await svc.definir('ent1', 'PADRAO')
    expect(prisma.configuracaoDashboard.upsert).toHaveBeenCalledWith({
      where: { entidadeId: 'ent1' },
      create: { entidadeId: 'ent1', granularidadePlano: 'PADRAO' },
      update: { granularidadePlano: 'PADRAO' },
    })
  })
})
