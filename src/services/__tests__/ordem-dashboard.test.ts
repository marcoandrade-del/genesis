import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { OrdemDashboardService, aplicarOrdemRaizes } from '../ordem-dashboard.js'

describe('OrdemDashboardService', () => {
  let prisma: PrismaMock
  let service: OrdemDashboardService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new OrdemDashboardService(prisma as never)
  })

  it('ordemDe devolve mapa itemId→ordem', async () => {
    prisma.ordemItemUsuario.findMany.mockResolvedValue([
      { itemId: 'a', ordem: 1 },
      { itemId: 'b', ordem: 0 },
    ])
    const m = await service.ordemDe('u1')
    expect(m.get('a')).toBe(1)
    expect(m.get('b')).toBe(0)
  })

  it('definir limpa e regrava com ordem = índice (em transação)', async () => {
    await service.definir('u1', ['x', 'y', 'z'])
    expect(prisma.ordemItemUsuario.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: 'u1' } })
    expect(prisma.ordemItemUsuario.createMany).toHaveBeenCalledWith({
      data: [
        { usuarioId: 'u1', itemId: 'x', ordem: 0 },
        { usuarioId: 'u1', itemId: 'y', ordem: 1 },
        { usuarioId: 'u1', itemId: 'z', ordem: 2 },
      ],
    })
  })

  it('definir com lista vazia só limpa (não cria)', async () => {
    await service.definir('u1', [])
    expect(prisma.ordemItemUsuario.deleteMany).toHaveBeenCalled()
    expect(prisma.ordemItemUsuario.createMany).not.toHaveBeenCalled()
  })

  it('restaurar apaga as preferências do usuário', async () => {
    await service.restaurar('u1')
    expect(prisma.ordemItemUsuario.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: 'u1' } })
  })
})

describe('aplicarOrdemRaizes', () => {
  const raizes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('sem preferência mantém a ordem original', () => {
    expect(aplicarOrdemRaizes(raizes, new Map()).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('reordena pela preferência do usuário', () => {
    const ordem = new Map([['c', 0], ['a', 1], ['b', 2]])
    expect(aplicarOrdemRaizes(raizes, ordem).map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('itens sem preferência vão para o fim, preservando a ordem de entrada', () => {
    const ordem = new Map([['b', 0]]) // só b tem preferência
    expect(aplicarOrdemRaizes(raizes, ordem).map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })
})
