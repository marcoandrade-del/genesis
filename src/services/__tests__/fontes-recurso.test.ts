import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { FontesRecursoService } from '../fontes-recurso.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const MODELO = { id: 'm1', descricao: 'PARANÁ', ativo: true }
const FONTE = {
  id: 'fr1', modeloContabilId: 'm1', ano: 2026, codigo: '500',
  nomenclatura: 'Recursos não Vinculados de Impostos', especificacao: null,
  vinculada: false, grupo: 'Livres', criadoEm: new Date(), atualizadoEm: new Date(),
}

const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })
const erroP2025 = new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: FontesRecursoService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new FontesRecursoService(prisma as never)
})

describe('FontesRecursoService.listar', () => {
  it('sem filtros lista tudo ordenado por ano desc + codigo', async () => {
    prisma.fonteRecurso.findMany.mockResolvedValue([FONTE])
    expect(await service.listar()).toEqual([FONTE])
    expect(prisma.fonteRecurso.findMany).toHaveBeenCalledWith({
      where: {}, orderBy: [{ ano: 'desc' }, { codigo: 'asc' }],
    })
  })

  it('filtra por modeloContabilId e ano', async () => {
    prisma.fonteRecurso.findMany.mockResolvedValue([])
    await service.listar({ modeloContabilId: 'm1', ano: 2026 })
    expect(prisma.fonteRecurso.findMany).toHaveBeenCalledWith({
      where: { modeloContabilId: 'm1', ano: 2026 }, orderBy: [{ ano: 'desc' }, { codigo: 'asc' }],
    })
  })

  it('filtra só por ano (inclusive ano 0)', async () => {
    prisma.fonteRecurso.findMany.mockResolvedValue([])
    await service.listar({ ano: 0 })
    expect(prisma.fonteRecurso.findMany).toHaveBeenCalledWith({
      where: { ano: 0 }, orderBy: [{ ano: 'desc' }, { codigo: 'asc' }],
    })
  })
})

describe('FontesRecursoService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.fonteRecurso.findUnique.mockResolvedValue(FONTE)
    expect(await service.buscarPorId('fr1')).toEqual(FONTE)
  })
})

describe('FontesRecursoService.criar', () => {
  it('cria com defaults (vinculada=true) quando opcionais ausentes', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.fonteRecurso.create.mockResolvedValue(FONTE)
    await service.criar({ modeloContabilId: 'm1', ano: 2026, codigo: '540', nomenclatura: 'FUNDEB' })
    expect(prisma.fonteRecurso.create).toHaveBeenCalledWith({
      data: { modeloContabilId: 'm1', ano: 2026, codigo: '540', nomenclatura: 'FUNDEB', vinculada: true },
    })
  })

  it('inclui especificacao, grupo e vinculada quando informados', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.fonteRecurso.create.mockResolvedValue(FONTE)
    await service.criar({
      modeloContabilId: 'm1', ano: 2026, codigo: '500', nomenclatura: 'Livres',
      especificacao: 'Recursos de impostos', vinculada: false, grupo: 'Livres',
    })
    expect(prisma.fonteRecurso.create).toHaveBeenCalledWith({
      data: {
        modeloContabilId: 'm1', ano: 2026, codigo: '500', nomenclatura: 'Livres',
        vinculada: false, especificacao: 'Recursos de impostos', grupo: 'Livres',
      },
    })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando modelo não existe', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(null)
    await expect(service.criar({ modeloContabilId: 'mx', ano: 2026, codigo: '500', nomenclatura: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.fonteRecurso.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO em P2002 (codigo duplicado no modelo+ano)', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.fonteRecurso.create.mockRejectedValue(erroP2002)
    await expect(service.criar({ modeloContabilId: 'm1', ano: 2026, codigo: '500', nomenclatura: 'X' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.modeloContabil.findUnique.mockResolvedValue(MODELO)
    prisma.fonteRecurso.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar({ modeloContabilId: 'm1', ano: 2026, codigo: '500', nomenclatura: 'X' }))
      .rejects.toThrow('boom')
  })
})

describe('FontesRecursoService.atualizar', () => {
  it('atualiza campos editáveis', async () => {
    prisma.fonteRecurso.update.mockResolvedValue({ ...FONTE, nomenclatura: 'Novo' })
    const r = await service.atualizar('fr1', { nomenclatura: 'Novo', vinculada: true })
    expect(r.nomenclatura).toBe('Novo')
    expect(prisma.fonteRecurso.update).toHaveBeenCalledWith({ where: { id: 'fr1' }, data: { nomenclatura: 'Novo', vinculada: true } })
  })

  it('lança RECURSO_NAO_ENCONTRADO em P2025', async () => {
    prisma.fonteRecurso.update.mockRejectedValue(erroP2025)
    await expect(service.atualizar('xx', { nomenclatura: 'Y' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.fonteRecurso.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('fr1', { nomenclatura: 'Y' })).rejects.toThrow('boom')
  })

  it('propaga Prisma error com código não tratado', async () => {
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.fonteRecurso.update.mockRejectedValue(erro)
    await expect(service.atualizar('fr1', { nomenclatura: 'Y' })).rejects.toBe(erro)
  })
})

describe('FontesRecursoService.excluir', () => {
  it('exclui quando existe', async () => {
    prisma.fonteRecurso.findUnique.mockResolvedValue(FONTE)
    await service.excluir('fr1')
    expect(prisma.fonteRecurso.delete).toHaveBeenCalledWith({ where: { id: 'fr1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.fonteRecurso.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.fonteRecurso.delete).not.toHaveBeenCalled()
  })
})
