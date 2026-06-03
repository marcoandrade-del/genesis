import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ItensCatalogoService } from '../itens-catalogo.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: ItensCatalogoService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ItensCatalogoService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    tipo: 'MATERIAL',
    codigo: '123456',
    descricao: 'Caneta esferográfica azul',
    unidadeMedida: 'UN',
    ...over,
  } as never
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' })
}

describe('ItensCatalogoService.listar', () => {
  it('lista com filtro de tipo e ativos', async () => {
    prisma.itemCatalogo.findMany.mockResolvedValue([])
    await service.listar({ tipo: 'SERVICO', apenasAtivos: true })
    expect(prisma.itemCatalogo.findMany).toHaveBeenCalledWith({
      where: { tipo: 'SERVICO', ativo: true },
      orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
    })
  })

  it('sem filtro lista tudo', async () => {
    prisma.itemCatalogo.findMany.mockResolvedValue([])
    await service.listar()
    expect(prisma.itemCatalogo.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
    })
  })
})

describe('ItensCatalogoService.criar — validação', () => {
  it('rejeita tipo inválido', async () => {
    await expect(service.criar(dadosOk({ tipo: 'OUTRO' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
  it.each(['codigo', 'descricao', 'unidadeMedida'])('rejeita %s vazio', async (campo) => {
    await expect(service.criar(dadosOk({ [campo]: '   ' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
})

describe('ItensCatalogoService.criar — persistência', () => {
  it('cria normalizando e default ativo=true', async () => {
    prisma.itemCatalogo.create.mockResolvedValue({ id: 'i1' })
    await service.criar(dadosOk({ codigo: ' 99 ', descricao: ' X ', unidadeMedida: ' CX ' }))
    expect(prisma.itemCatalogo.create).toHaveBeenCalledWith({
      data: { tipo: 'MATERIAL', codigo: '99', descricao: 'X', unidadeMedida: 'CX', ativo: true },
    })
  })

  it('código duplicado vira CONFLITO', async () => {
    prisma.itemCatalogo.create.mockRejectedValue(p2002())
    await expect(service.criar(dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros', async () => {
    prisma.itemCatalogo.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar(dadosOk())).rejects.toThrow('boom')
  })
})

describe('ItensCatalogoService.atualizar', () => {
  it('404 quando não existe', async () => {
    prisma.itemCatalogo.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('x', dadosOk())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('atualiza no caminho feliz', async () => {
    prisma.itemCatalogo.findUnique.mockResolvedValue({ id: 'i1' })
    prisma.itemCatalogo.update.mockResolvedValue({ id: 'i1' })
    await service.atualizar('i1', dadosOk({ tipo: 'SERVICO' }))
    expect(prisma.itemCatalogo.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: expect.objectContaining({ tipo: 'SERVICO', codigo: '123456' }),
    })
  })
})

describe('ItensCatalogoService.excluir', () => {
  it('404 quando não existe', async () => {
    prisma.itemCatalogo.findUnique.mockResolvedValue(null)
    await expect(service.excluir('x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('item em uso (P2003) vira CONFLITO', async () => {
    prisma.itemCatalogo.findUnique.mockResolvedValue({ id: 'i1' })
    prisma.itemCatalogo.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.7.0' }),
    )
    await expect(service.excluir('i1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui no caminho feliz', async () => {
    prisma.itemCatalogo.findUnique.mockResolvedValue({ id: 'i1' })
    prisma.itemCatalogo.delete.mockResolvedValue({})
    await service.excluir('i1')
    expect(prisma.itemCatalogo.delete).toHaveBeenCalledWith({ where: { id: 'i1' } })
  })
})

describe('ItensCatalogoService.contar', () => {
  it('conta com ativos + busca (OR código/descrição, descrição insensitive)', async () => {
    prisma.itemCatalogo.count.mockResolvedValue(3)
    const n = await service.contar({ apenasAtivos: true, busca: 'caneta' })
    expect(n).toBe(3)
    expect(prisma.itemCatalogo.count).toHaveBeenCalledWith({
      where: {
        ativo: true,
        OR: [{ codigo: { contains: 'caneta' } }, { descricao: { contains: 'caneta', mode: 'insensitive' } }],
      },
    })
  })

  it('sem busca não inclui OR', async () => {
    prisma.itemCatalogo.count.mockResolvedValue(0)
    await service.contar({ apenasAtivos: true })
    expect(prisma.itemCatalogo.count).toHaveBeenCalledWith({ where: { ativo: true } })
  })
})

describe('ItensCatalogoService.listarPaginado', () => {
  it('aplica skip/take e calcula totalPaginas', async () => {
    prisma.itemCatalogo.count.mockResolvedValue(120)
    prisma.itemCatalogo.findMany.mockResolvedValue([{ id: 'i1' }])
    const r = await service.listarPaginado({ apenasAtivos: true, pagina: 2, porPagina: 50 })
    expect(r).toMatchObject({ total: 120, pagina: 2, porPagina: 50, totalPaginas: 3, itens: [{ id: 'i1' }] })
    expect(prisma.itemCatalogo.findMany).toHaveBeenCalledWith({
      where: { ativo: true },
      orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
      skip: 50,
      take: 50,
    })
  })

  it('clampa página < 1 e porPagina ao teto (200); total 0 → 1 página', async () => {
    prisma.itemCatalogo.count.mockResolvedValue(0)
    prisma.itemCatalogo.findMany.mockResolvedValue([])
    const r = await service.listarPaginado({ pagina: 0, porPagina: 9999 })
    expect(r.pagina).toBe(1)
    expect(r.porPagina).toBe(200)
    expect(r.totalPaginas).toBe(1)
    expect(prisma.itemCatalogo.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 200 }))
  })
})
