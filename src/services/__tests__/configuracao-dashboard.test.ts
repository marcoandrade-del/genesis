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

  describe('granularidade por relatório (override esparso)', () => {
    it('usa o override do relatório quando existe', async () => {
      prisma.preferenciaRelatorioPlano.findUnique.mockResolvedValue({ granularidadePlano: 'PADRAO' })
      expect(await svc.granularidadeRelatorio('ent1', '/contas')).toBe('PADRAO')
    })

    it('sem override, cai no default da entidade', async () => {
      prisma.preferenciaRelatorioPlano.findUnique.mockResolvedValue(null)
      prisma.configuracaoDashboard.findUnique.mockResolvedValue(null) // default DESDOBRADO
      expect(await svc.granularidadeRelatorio('ent1', '/contas')).toBe('DESDOBRADO')
    })

    it('definirRelatorio NÃO grava quando a escolha é igual ao default (remove override)', async () => {
      prisma.configuracaoDashboard.findUnique.mockResolvedValue(null) // default DESDOBRADO
      await svc.definirRelatorio('ent1', '/contas', 'DESDOBRADO')
      expect(prisma.preferenciaRelatorioPlano.deleteMany).toHaveBeenCalledWith({ where: { entidadeId: 'ent1', relatorio: '/contas' } })
      expect(prisma.preferenciaRelatorioPlano.upsert).not.toHaveBeenCalled()
    })

    it('definirRelatorio grava override quando a escolha difere do default', async () => {
      prisma.configuracaoDashboard.findUnique.mockResolvedValue(null) // default DESDOBRADO
      await svc.definirRelatorio('ent1', '/contas', 'PADRAO')
      expect(prisma.preferenciaRelatorioPlano.upsert).toHaveBeenCalledWith({
        where: { entidadeId_relatorio: { entidadeId: 'ent1', relatorio: '/contas' } },
        create: { entidadeId: 'ent1', relatorio: '/contas', granularidadePlano: 'PADRAO' },
        update: { granularidadePlano: 'PADRAO' },
      })
      expect(prisma.preferenciaRelatorioPlano.deleteMany).not.toHaveBeenCalled()
    })
  })
})
