import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { MeusRelatoriosOrgService } from '../meus-relatorios-org.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

describe('MeusRelatoriosOrgService', () => {
  let prisma: PrismaMock
  let svc: MeusRelatoriosOrgService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new MeusRelatoriosOrgService(prisma as unknown as PrismaClient)
  })

  describe('arvore', () => {
    it('monta a árvore com relatórios em pastas e os sem pasta', async () => {
      prisma.pastaFavorito.findMany.mockResolvedValue([
        { id: 'p1', nome: 'Pasta A', parentId: null },
        { id: 'p2', nome: 'Sub', parentId: 'p1' },
      ])
      prisma.relatorioPersonalizado.findMany.mockResolvedValue([
        { id: 'r1', nome: 'R1', descricao: null, cabecalhoId: null, rodapeId: null },
        { id: 'r2', nome: 'R2', descricao: null, cabecalhoId: null, rodapeId: null },
        { id: 'r3', nome: 'R3', descricao: null, cabecalhoId: null, rodapeId: null },
      ])
      prisma.favoritoRelatorio.findMany.mockResolvedValue([
        { pastaId: 'p1', relatorioPersonalizadoId: 'r1' },
        { pastaId: 'p2', relatorioPersonalizadoId: 'r2' },
        { pastaId: null, relatorioPersonalizadoId: 'desconhecido' },
        { pastaId: 'p1', relatorioPersonalizadoId: null }, // vínculo de relatório fixo: ignorado
      ])
      const { raizes, semPasta } = await svc.arvore('u1', 'ent1')
      expect(raizes).toHaveLength(1)
      expect(raizes[0]!.nome).toBe('Pasta A')
      expect(raizes[0]!.relatorios.map((r) => r.id)).toEqual(['r1'])
      expect(raizes[0]!.filhos).toHaveLength(1)
      expect(raizes[0]!.filhos[0]!.relatorios.map((r) => r.id)).toEqual(['r2'])
      expect(semPasta.map((r) => r.id)).toEqual(['r3'])
    })

    it('relatório com vínculo a pasta inexistente cai em sem pasta', async () => {
      prisma.pastaFavorito.findMany.mockResolvedValue([])
      prisma.relatorioPersonalizado.findMany.mockResolvedValue([{ id: 'r1', nome: 'R1', descricao: null, cabecalhoId: null, rodapeId: null }])
      prisma.favoritoRelatorio.findMany.mockResolvedValue([{ pastaId: 'sumiu', relatorioPersonalizadoId: 'r1' }])
      const { semPasta } = await svc.arvore('u1', 'ent1')
      expect(semPasta.map((r) => r.id)).toEqual(['r1'])
    })
  })

  it('listarPastas filtra por usuário+entidade', async () => {
    prisma.pastaFavorito.findMany.mockResolvedValue([{ id: 'p1', nome: 'A' }])
    await svc.listarPastas('u1', 'ent1')
    expect(prisma.pastaFavorito.findMany).toHaveBeenCalledWith({
      where: { usuarioId: 'u1', entidadeId: 'ent1' },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    })
  })

  describe('criarPasta', () => {
    it('cria pasta raiz', async () => {
      prisma.pastaFavorito.create.mockResolvedValue({ id: 'p1' })
      await svc.criarPasta('u1', 'ent1', { nome: '  Contas  ' })
      expect(prisma.pastaFavorito.create).toHaveBeenCalledWith({ data: { usuarioId: 'u1', entidadeId: 'ent1', nome: 'Contas', parentId: null } })
    })
    it('valida a pasta-pai (mesmo usuário/entidade)', async () => {
      prisma.pastaFavorito.findUnique.mockResolvedValue({ id: 'pai', usuarioId: 'u1', entidadeId: 'ent1' })
      prisma.pastaFavorito.create.mockResolvedValue({ id: 'p2' })
      await svc.criarPasta('u1', 'ent1', { nome: 'Sub', parentId: 'pai' })
      expect(prisma.pastaFavorito.create).toHaveBeenCalledWith({ data: { usuarioId: 'u1', entidadeId: 'ent1', nome: 'Sub', parentId: 'pai' } })
    })
    it('rejeita pai inexistente/de outro escopo', async () => {
      prisma.pastaFavorito.findUnique.mockResolvedValue(null)
      await expect(svc.criarPasta('u1', 'ent1', { nome: 'Sub', parentId: 'x' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })
    it('rejeita nome vazio, não-string e longo demais', async () => {
      await expect(svc.criarPasta('u1', 'ent1', { nome: '  ' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criarPasta('u1', 'ent1', { nome: 123 })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criarPasta('u1', 'ent1', { nome: 'a'.repeat(81) })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('parentId não-string é ignorado (vira raiz)', async () => {
      prisma.pastaFavorito.create.mockResolvedValue({ id: 'p1' })
      await svc.criarPasta('u1', 'ent1', { nome: 'X', parentId: 42 })
      expect(prisma.pastaFavorito.create).toHaveBeenCalledWith({ data: { usuarioId: 'u1', entidadeId: 'ent1', nome: 'X', parentId: null } })
    })
  })

  describe('renomearPasta', () => {
    it('renomeia pasta própria', async () => {
      prisma.pastaFavorito.findUnique.mockResolvedValue({ id: 'p1', usuarioId: 'u1', entidadeId: 'ent1' })
      prisma.pastaFavorito.update.mockResolvedValue({ id: 'p1' })
      await svc.renomearPasta('p1', 'u1', 'ent1', 'Novo')
      expect(prisma.pastaFavorito.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { nome: 'Novo' } })
    })
    it('rejeita inexistente', async () => {
      prisma.pastaFavorito.findUnique.mockResolvedValue(null)
      await expect(svc.renomearPasta('p1', 'u1', 'ent1', 'X')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })
  })

  describe('excluirPasta', () => {
    beforeEach(() => prisma.pastaFavorito.findUnique.mockResolvedValue({ id: 'p1', usuarioId: 'u1', entidadeId: 'ent1' }))
    it('exclui pasta vazia', async () => {
      prisma.pastaFavorito.count.mockResolvedValue(0)
      prisma.favoritoRelatorio.count.mockResolvedValue(0)
      prisma.pastaFavorito.delete.mockResolvedValue({ id: 'p1' })
      await svc.excluirPasta('p1', 'u1', 'ent1')
      expect(prisma.pastaFavorito.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
    })
    it('rejeita se tem subpastas', async () => {
      prisma.pastaFavorito.count.mockResolvedValue(1)
      await expect(svc.excluirPasta('p1', 'u1', 'ent1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })
    it('rejeita se tem relatórios dentro', async () => {
      prisma.pastaFavorito.count.mockResolvedValue(0)
      prisma.favoritoRelatorio.count.mockResolvedValue(2)
      await expect(svc.excluirPasta('p1', 'u1', 'ent1')).rejects.toMatchObject({ code: 'CONFLITO' })
    })
    it('rejeita inexistente', async () => {
      prisma.pastaFavorito.findUnique.mockResolvedValue(null)
      await expect(svc.excluirPasta('p1', 'u1', 'ent1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })
  })

  describe('atribuirRelatorio', () => {
    beforeEach(() => prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ id: 'r1', usuarioId: 'u1', entidadeId: 'ent1' }))

    it('coloca em pasta (cria vínculo se não havia)', async () => {
      prisma.pastaFavorito.findUnique.mockResolvedValue({ id: 'p1', usuarioId: 'u1', entidadeId: 'ent1' })
      prisma.favoritoRelatorio.findFirst.mockResolvedValue(null)
      prisma.favoritoRelatorio.create.mockResolvedValue({ id: 'f1' })
      await svc.atribuirRelatorio('r1', 'u1', 'ent1', 'p1')
      expect(prisma.favoritoRelatorio.create).toHaveBeenCalledWith({ data: { usuarioId: 'u1', relatorioPersonalizadoId: 'r1', pastaId: 'p1' } })
    })

    it('move para outra pasta (atualiza vínculo existente)', async () => {
      prisma.pastaFavorito.findUnique.mockResolvedValue({ id: 'p2', usuarioId: 'u1', entidadeId: 'ent1' })
      prisma.favoritoRelatorio.findFirst.mockResolvedValue({ id: 'f1' })
      prisma.favoritoRelatorio.update.mockResolvedValue({ id: 'f1' })
      await svc.atribuirRelatorio('r1', 'u1', 'ent1', 'p2')
      expect(prisma.favoritoRelatorio.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { pastaId: 'p2' } })
    })

    it('sem pasta (pastaId vazio) remove o vínculo se houver', async () => {
      prisma.favoritoRelatorio.findFirst.mockResolvedValue({ id: 'f1' })
      prisma.favoritoRelatorio.delete.mockResolvedValue({ id: 'f1' })
      const r = await svc.atribuirRelatorio('r1', 'u1', 'ent1', '')
      expect(prisma.favoritoRelatorio.delete).toHaveBeenCalledWith({ where: { id: 'f1' } })
      expect(r).toBeNull()
    })

    it('sem pasta e sem vínculo é no-op', async () => {
      prisma.favoritoRelatorio.findFirst.mockResolvedValue(null)
      const r = await svc.atribuirRelatorio('r1', 'u1', 'ent1', null)
      expect(r).toBeNull()
      expect(prisma.favoritoRelatorio.delete).not.toHaveBeenCalled()
    })

    it('rejeita relatório de outro dono', async () => {
      prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ id: 'r1', usuarioId: 'OUTRO', entidadeId: 'ent1' })
      await expect(svc.atribuirRelatorio('r1', 'u1', 'ent1', 'p1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })

    it('rejeita pasta de outro escopo', async () => {
      prisma.pastaFavorito.findUnique.mockResolvedValue(null)
      await expect(svc.atribuirRelatorio('r1', 'u1', 'ent1', 'p1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })
  })
})
