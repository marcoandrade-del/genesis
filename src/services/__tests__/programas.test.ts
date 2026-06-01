import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ProgramasService } from '../programas.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura' }

let prisma: PrismaMock
let service: ProgramasService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ProgramasService(prisma as never)
})

function dadosOk() {
  return {
    codigo: '0001',
    nome: 'EDUCAÇÃO DE QUALIDADE',
    tipo: 'FINALISTICO' as const,
    objetivo: 'Universalizar acesso ao ensino fundamental',
    ativo: true,
  }
}

describe('ProgramasService.listar', () => {
  it('lista por entidade+ano com contagem de ações', async () => {
    prisma.programa.findMany.mockResolvedValue([])
    await service.listar('ent1', 2026)
    expect(prisma.programa.findMany).toHaveBeenCalledWith({
      where: { entidadeId: 'ent1', ano: 2026 },
      orderBy: { codigo: 'asc' },
      include: { _count: { select: { acoes: true } } },
    })
  })
})

describe('ProgramasService.buscarPorId', () => {
  it('inclui ações ordenadas por código', async () => {
    prisma.programa.findUnique.mockResolvedValue(null)
    await service.buscarPorId('p1')
    expect(prisma.programa.findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      include: { acoes: { orderBy: { codigo: 'asc' } } },
    })
  })
})

describe('ProgramasService.criar', () => {
  it('caminho feliz: cria com trim, ativo default true', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.programa.create.mockResolvedValue({ id: 'p1' })
    await service.criar('ent1', 2026, { ...dadosOk(), codigo: '  0001  ', nome: '  X  ' })
    expect(prisma.programa.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entidadeId: 'ent1',
        ano: 2026,
        codigo: '0001',
        nome: 'X',
        tipo: 'FINALISTICO',
        ativo: true,
      }),
    })
  })

  it('objetivo vazio vira null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.programa.create.mockResolvedValue({ id: 'p1' })
    await service.criar('ent1', 2026, { ...dadosOk(), objetivo: '   ' })
    expect(prisma.programa.create.mock.calls[0][0].data.objetivo).toBeNull()
  })

  it('objetivo null/undefined vira null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.programa.create.mockResolvedValue({ id: 'p1' })
    await service.criar('ent1', 2026, { ...dadosOk(), objetivo: null })
    expect(prisma.programa.create.mock.calls[0][0].data.objetivo).toBeNull()
    prisma.programa.create.mockClear()
    await service.criar('ent1', 2026, { ...dadosOk(), objetivo: undefined })
    expect(prisma.programa.create.mock.calls[0][0].data.objetivo).toBeNull()
  })

  it('ativo default true quando omitido', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.programa.create.mockResolvedValue({ id: 'p1' })
    const d = dadosOk()
    delete (d as Partial<typeof d>).ativo
    await service.criar('ent1', 2026, d)
    expect(prisma.programa.create.mock.calls[0][0].data.ativo).toBe(true)
  })

  it('rejeita código vazio', async () => {
    await expect(service.criar('ent1', 2026, { ...dadosOk(), codigo: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    expect(prisma.entidade.findUnique).not.toHaveBeenCalled()
  })

  it('rejeita código undefined', async () => {
    await expect(
      service.criar('ent1', 2026, { ...dadosOk(), codigo: undefined as never }),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita nome vazio', async () => {
    await expect(service.criar('ent1', 2026, { ...dadosOk(), nome: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('rejeita nome undefined', async () => {
    await expect(
      service.criar('ent1', 2026, { ...dadosOk(), nome: undefined as never }),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita tipo inválido', async () => {
    await expect(
      service.criar('ent1', 2026, { ...dadosOk(), tipo: 'OUTRO' as never }),
    ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA', message: expect.stringContaining('Tipo inválido') })
  })

  it('rejeita quando entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('xx', 2026, dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('código duplicado vira CONFLITO', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.programa.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.criar('ent1', 2026, dadosOk())).rejects.toMatchObject({
      code: 'CONFLITO',
    })
  })

  it('repassa outros erros', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.programa.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('ent1', 2026, dadosOk())).rejects.toThrow('boom')
  })
})

describe('ProgramasService.atualizar', () => {
  const EXISTENTE = { id: 'p1', entidadeId: 'ent1', ano: 2026, codigo: '0001', ativo: true }

  it('atualiza com trim', async () => {
    prisma.programa.findUnique.mockResolvedValue(EXISTENTE)
    prisma.programa.update.mockResolvedValue(EXISTENTE)
    await service.atualizar('p1', { ...dadosOk(), codigo: '  0002  ' })
    expect(prisma.programa.update.mock.calls[0][0].data.codigo).toBe('0002')
  })

  it('preserva ativo quando omitido', async () => {
    prisma.programa.findUnique.mockResolvedValue({ ...EXISTENTE, ativo: false })
    prisma.programa.update.mockResolvedValue(EXISTENTE)
    const d = dadosOk()
    delete (d as Partial<typeof d>).ativo
    await service.atualizar('p1', d)
    expect(prisma.programa.update.mock.calls[0][0].data.ativo).toBe(false)
  })

  it('rejeita validação antes de qualquer query', async () => {
    await expect(service.atualizar('p1', { ...dadosOk(), codigo: '   ' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
    expect(prisma.programa.findUnique).not.toHaveBeenCalled()
  })

  it('404 quando programa não existe', async () => {
    prisma.programa.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', dadosOk())).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('código duplicado vira CONFLITO', async () => {
    prisma.programa.findUnique.mockResolvedValue(EXISTENTE)
    prisma.programa.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.atualizar('p1', dadosOk())).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros', async () => {
    prisma.programa.findUnique.mockResolvedValue(EXISTENTE)
    prisma.programa.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('p1', dadosOk())).rejects.toThrow('boom')
  })
})

describe('ProgramasService.excluir', () => {
  it('exclui quando sem ações', async () => {
    prisma.programa.findUnique.mockResolvedValue({ id: 'p1', _count: { acoes: 0 } })
    prisma.programa.delete.mockResolvedValue({})
    await service.excluir('p1')
    expect(prisma.programa.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })

  it('404 quando não existe', async () => {
    prisma.programa.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.programa.delete).not.toHaveBeenCalled()
  })

  it('bloqueia quando há ações vinculadas', async () => {
    prisma.programa.findUnique.mockResolvedValue({ id: 'p1', _count: { acoes: 3 } })
    await expect(service.excluir('p1')).rejects.toMatchObject({
      code: 'CONFLITO',
      message: expect.stringContaining('3 ação'),
    })
    expect(prisma.programa.delete).not.toHaveBeenCalled()
  })
})
