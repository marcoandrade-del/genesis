import { describe, it, expect, beforeEach } from 'vitest'
import { FuncoesService } from '../funcoes.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: FuncoesService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new FuncoesService(prisma as never)
})

describe('FuncoesService', () => {
  it('listar inclui subfunções ordenadas por código', async () => {
    prisma.funcao.findMany.mockResolvedValue([])
    await service.listar()
    expect(prisma.funcao.findMany).toHaveBeenCalledWith({
      orderBy: { codigo: 'asc' },
      include: { subfuncoes: { orderBy: { codigo: 'asc' } } },
    })
  })

  it('buscarPorId inclui subfunções', async () => {
    prisma.funcao.findUnique.mockResolvedValue(null)
    await service.buscarPorId('f1')
    expect(prisma.funcao.findUnique).toHaveBeenCalledWith({
      where: { id: 'f1' },
      include: { subfuncoes: { orderBy: { codigo: 'asc' } } },
    })
  })

  it('listarSubfuncoes inclui função pai (codigo+nome)', async () => {
    prisma.subfuncao.findMany.mockResolvedValue([])
    await service.listarSubfuncoes()
    expect(prisma.subfuncao.findMany).toHaveBeenCalledWith({
      orderBy: { codigo: 'asc' },
      include: { funcao: { select: { codigo: true, nome: true } } },
    })
  })
})
