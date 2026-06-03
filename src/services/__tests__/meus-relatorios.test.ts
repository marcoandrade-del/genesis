import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { MeusRelatoriosService } from '../meus-relatorios.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

describe('MeusRelatoriosService', () => {
  let prisma: PrismaMock
  let svc: MeusRelatoriosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new MeusRelatoriosService(prisma as unknown as PrismaClient)
  })

  it('lista por usuário + entidade', async () => {
    prisma.relatorioPersonalizado.findMany.mockResolvedValue([{ id: 'rp1' }])
    await svc.listar('u1', 'ent1')
    expect(prisma.relatorioPersonalizado.findMany).toHaveBeenCalledWith({
      where: { usuarioId: 'u1', entidadeId: 'ent1' },
      orderBy: { nome: 'asc' },
    })
  })

  it('busca incluindo cabeçalho e rodapé', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ id: 'rp1' })
    await svc.buscar('rp1')
    expect(prisma.relatorioPersonalizado.findUnique).toHaveBeenCalledWith({
      where: { id: 'rp1' },
      include: { cabecalho: true, rodape: true },
    })
  })

  describe('criar', () => {
    it('cria normalizando nome/query/descrição e configuracao {}', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue({ id: 'c1', entidadeId: 'ent1' })
      prisma.rodapeRelatorio.findUnique.mockResolvedValue({ id: 'r1', entidadeId: 'ent1' })
      prisma.relatorioPersonalizado.create.mockResolvedValue({ id: 'rp1' })
      await svc.criar('u1', 'ent1', {
        nome: '  Lançamentos  ',
        descricao: '  do ano  ',
        query: 'SELECT * FROM rel_lancamentos;',
        cabecalhoId: 'c1',
        rodapeId: 'r1',
      })
      expect(prisma.relatorioPersonalizado.create).toHaveBeenCalledWith({
        data: {
          usuarioId: 'u1',
          entidadeId: 'ent1',
          nome: 'Lançamentos',
          descricao: 'do ano',
          query: 'SELECT * FROM rel_lancamentos',
          cabecalhoId: 'c1',
          rodapeId: 'r1',
          configuracao: {},
        },
      })
    })

    it('descrição vazia vira null e sem templates fica null', async () => {
      prisma.relatorioPersonalizado.create.mockResolvedValue({ id: 'rp1' })
      await svc.criar('u1', 'ent1', { nome: 'X', query: 'select 1' })
      const data = (prisma.relatorioPersonalizado.create as any).mock.calls[0][0].data
      expect(data.descricao).toBeNull()
      expect(data.cabecalhoId).toBeNull()
      expect(data.rodapeId).toBeNull()
    })

    it('rejeita nome vazio', async () => {
      await expect(svc.criar('u1', 'ent1', { nome: '  ', query: 'select 1' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita query vazia e query não-SELECT', async () => {
      await expect(svc.criar('u1', 'ent1', { nome: 'X', query: '' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criar('u1', 'ent1', { nome: 'X', query: 'DELETE FROM x' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita nome não-string e nome longo demais', async () => {
      await expect(svc.criar('u1', 'ent1', { nome: 123, query: 'select 1' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criar('u1', 'ent1', { nome: 'a'.repeat(121), query: 'select 1' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita query não-string e query longa demais', async () => {
      await expect(svc.criar('u1', 'ent1', { nome: 'X', query: 123 })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criar('u1', 'ent1', { nome: 'X', query: 'select ' + 'a'.repeat(20001) })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita cabeçalho de outra entidade', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue({ id: 'c1', entidadeId: 'OUTRA' })
      await expect(svc.criar('u1', 'ent1', { nome: 'X', query: 'select 1', cabecalhoId: 'c1' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita cabeçalho inexistente', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue(null)
      await expect(svc.criar('u1', 'ent1', { nome: 'X', query: 'select 1', cabecalhoId: 'c1' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita rodapé de outra entidade', async () => {
      prisma.rodapeRelatorio.findUnique.mockResolvedValue({ id: 'r1', entidadeId: 'OUTRA' })
      await expect(svc.criar('u1', 'ent1', { nome: 'X', query: 'select 1', rodapeId: 'r1' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })
  })

  describe('atualizar', () => {
    it('atualiza relatório próprio da entidade', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1' })
      prisma.relatorioPersonalizado.update.mockResolvedValue({ id: 'rp1' })
      await svc.atualizar('rp1', 'u1', 'ent1', { nome: 'Novo', query: 'select 2' })
      expect(prisma.relatorioPersonalizado.update).toHaveBeenCalledWith({
        where: { id: 'rp1' },
        data: { nome: 'Novo', descricao: null, query: 'select 2', cabecalhoId: null, rodapeId: null },
      })
    })

    it('rejeita inexistente, de outro usuário ou de outra entidade', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue(null)
      await expect(svc.atualizar('rp1', 'u1', 'ent1', { nome: 'X', query: 'select 1' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ id: 'rp1', usuarioId: 'OUTRO', entidadeId: 'ent1' })
      await expect(svc.atualizar('rp1', 'u1', 'ent1', { nome: 'X', query: 'select 1' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'OUTRA' })
      await expect(svc.atualizar('rp1', 'u1', 'ent1', { nome: 'X', query: 'select 1' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })
  })

  describe('excluir', () => {
    it('exclui relatório próprio sem favoritos', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1' })
      prisma.favoritoRelatorio.count.mockResolvedValue(0)
      prisma.relatorioPersonalizado.delete.mockResolvedValue({ id: 'rp1' })
      await svc.excluir('rp1', 'u1', 'ent1')
      expect(prisma.relatorioPersonalizado.delete).toHaveBeenCalledWith({ where: { id: 'rp1' } })
    })

    it('rejeita exclusão com favoritos vinculados', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ id: 'rp1', usuarioId: 'u1', entidadeId: 'ent1' })
      prisma.favoritoRelatorio.count.mockResolvedValue(2)
      await expect(svc.excluir('rp1', 'u1', 'ent1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })

    it('rejeita inexistente / de outro dono', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue(null)
      await expect(svc.excluir('rp1', 'u1', 'ent1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })
  })
})
