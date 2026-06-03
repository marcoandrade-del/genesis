import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { CabecalhosRodapesService, ELEMENTOS_CABECALHO, ELEMENTOS_RODAPE, ROTULOS_ELEMENTO } from '../cabecalhos-rodapes.js'
import { ErroNegocio } from '../../errors.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura' }

describe('CabecalhosRodapesService', () => {
  let prisma: PrismaMock
  let svc: CabecalhosRodapesService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new CabecalhosRodapesService(prisma as unknown as PrismaClient)
  })

  describe('exports', () => {
    it('cabeçalho aceita NUMERO_PAGINA e BRASAO; rodapé aceita ENDERECO mas não BRASAO', () => {
      expect(ELEMENTOS_CABECALHO).toContain('BRASAO')
      expect(ELEMENTOS_RODAPE).toContain('ENDERECO_ENTIDADE')
      expect(ELEMENTOS_RODAPE).not.toContain('BRASAO')
      expect(ROTULOS_ELEMENTO['NUMERO_PAGINA']).toBe('Número da página')
    })
  })

  // ── Cabeçalhos ──────────────────────────────────────────────────────────────

  describe('listarCabecalhos / buscarCabecalho', () => {
    it('lista filtrando por entidade e ordenando por nome', async () => {
      prisma.cabecalhoRelatorio.findMany.mockResolvedValue([{ id: 'c1' }])
      const r = await svc.listarCabecalhos('ent1')
      expect(r).toEqual([{ id: 'c1' }])
      expect(prisma.cabecalhoRelatorio.findMany).toHaveBeenCalledWith({ where: { entidadeId: 'ent1' }, orderBy: { nome: 'asc' } })
    })
    it('busca por id', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue({ id: 'c1' })
      expect(await svc.buscarCabecalho('c1')).toEqual({ id: 'c1' })
    })
  })

  describe('criarCabecalho', () => {
    beforeEach(() => prisma.entidade.findUnique.mockResolvedValue(ENTIDADE))

    it('cria com dados normalizados (altura default 120, layout normalizado)', async () => {
      prisma.cabecalhoRelatorio.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data }))
      const r = await svc.criarCabecalho('ent1', 'u1', {
        nome: '  Padrão  ',
        layout: [{ tipo: 'NOME_ENTIDADE', x: 10.005, y: 150 }],
      })
      expect(prisma.cabecalhoRelatorio.create).toHaveBeenCalledWith({
        data: {
          entidadeId: 'ent1',
          criadoPorId: 'u1',
          nome: 'Padrão',
          altura: 120,
          layout: [{ tipo: 'NOME_ENTIDADE', x: 10.01, y: 100 }], // x arredondado, y clampado a 100
        },
      })
      expect(r.id).toBe('c1')
    })

    it('aceita altura string e x/y string (coerção numérica)', async () => {
      prisma.cabecalhoRelatorio.create.mockResolvedValue({ id: 'c1' })
      await svc.criarCabecalho('ent1', 'u1', { nome: 'X', altura: '90', layout: [{ tipo: 'BRASAO', x: '-5', y: '20' }] })
      expect(prisma.cabecalhoRelatorio.create).toHaveBeenCalledWith({
        data: { entidadeId: 'ent1', criadoPorId: 'u1', nome: 'X', altura: 90, layout: [{ tipo: 'BRASAO', x: 0, y: 20 }] },
      })
    })

    it('arredonda altura fracionária', async () => {
      prisma.cabecalhoRelatorio.create.mockResolvedValue({ id: 'c1' })
      await svc.criarCabecalho('ent1', 'u1', { nome: 'X', altura: 90.7, layout: [{ tipo: 'BRASAO', x: 1, y: 1 }] })
      expect((prisma.cabecalhoRelatorio.create as any).mock.calls[0][0].data.altura).toBe(91)
    })

    it('rejeita entidade inexistente', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: [] })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })

    it('rejeita nome vazio / só espaços / não-string', async () => {
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: '   ', layout: [] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 123 as any, layout: [] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita nome longo demais', async () => {
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'a'.repeat(121), layout: [] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita altura fora da faixa e não-numérica', async () => {
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', altura: 30, layout: [] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', altura: 500, layout: [] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', altura: 'abc', layout: [] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita layout não-array', async () => {
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: { tipo: 'BRASAO' } })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita elemento não-objeto', async () => {
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: ['BRASAO'] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: [null] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita tipo não permitido na faixa (ENDERECO no cabeçalho)', async () => {
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: [{ tipo: 'ENDERECO_ENTIDADE', x: 0, y: 0 }] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: [{ tipo: 42, x: 0, y: 0 }] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita elemento duplicado', async () => {
      await expect(
        svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: [{ tipo: 'BRASAO', x: 0, y: 0 }, { tipo: 'BRASAO', x: 1, y: 1 }] }),
      ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita x/y não-finito', async () => {
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: [{ tipo: 'BRASAO', x: 'abc', y: 0 }] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita layout vazio (faixa precisa de ao menos um elemento)', async () => {
      await expect(svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: [] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('traduz violação de unicidade do nome (P2002) em erro de negócio', async () => {
      prisma.cabecalhoRelatorio.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
      await expect(
        svc.criarCabecalho('ent1', 'u1', { nome: 'Dup', layout: [{ tipo: 'BRASAO', x: 0, y: 0 }] }),
      ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('propaga erro não-P2002 do banco intacto', async () => {
      prisma.cabecalhoRelatorio.create.mockRejectedValue(Object.assign(new Error('boom'), { code: 'P2010' }))
      await expect(
        svc.criarCabecalho('ent1', 'u1', { nome: 'X', layout: [{ tipo: 'BRASAO', x: 0, y: 0 }] }),
      ).rejects.toMatchObject({ code: 'P2010' })
    })
  })

  describe('atualizarCabecalho', () => {
    it('atualiza mantendo altura atual quando omitida', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue({ id: 'c1', entidadeId: 'ent1', altura: 200 })
      prisma.cabecalhoRelatorio.update.mockResolvedValue({ id: 'c1' })
      await svc.atualizarCabecalho('c1', 'ent1', { nome: 'Novo', layout: [{ tipo: 'NOME_ENTIDADE', x: 0, y: 0 }] })
      expect(prisma.cabecalhoRelatorio.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { nome: 'Novo', altura: 200, layout: [{ tipo: 'NOME_ENTIDADE', x: 0, y: 0 }] } })
    })
    it('rejeita inexistente', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue(null)
      await expect(svc.atualizarCabecalho('c1', 'ent1', { nome: 'X', layout: [] })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })
    it('rejeita de outra entidade (guard multi-tenant)', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue({ id: 'c1', entidadeId: 'OUTRA', altura: 120 })
      await expect(svc.atualizarCabecalho('c1', 'ent1', { nome: 'X', layout: [] })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })
    it('traduz P2002 (nome duplicado) na atualização', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue({ id: 'c1', entidadeId: 'ent1', altura: 120 })
      prisma.cabecalhoRelatorio.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
      await expect(
        svc.atualizarCabecalho('c1', 'ent1', { nome: 'Dup', layout: [{ tipo: 'BRASAO', x: 0, y: 0 }] }),
      ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })
  })

  describe('excluirCabecalho', () => {
    it('exclui da própria entidade', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue({ id: 'c1', entidadeId: 'ent1' })
      prisma.cabecalhoRelatorio.delete.mockResolvedValue({ id: 'c1' })
      await svc.excluirCabecalho('c1', 'ent1')
      expect(prisma.cabecalhoRelatorio.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
    })
    it('rejeita inexistente / outra entidade', async () => {
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue(null)
      await expect(svc.excluirCabecalho('c1', 'ent1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
      prisma.cabecalhoRelatorio.findUnique.mockResolvedValue({ id: 'c1', entidadeId: 'OUTRA' })
      await expect(svc.excluirCabecalho('c1', 'ent1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })
  })

  // ── Rodapés (caminhos próprios + allowlist própria) ───────────────────────────

  describe('rodapés', () => {
    it('lista e busca', async () => {
      prisma.rodapeRelatorio.findMany.mockResolvedValue([{ id: 'r1' }])
      await svc.listarRodapes('ent1')
      expect(prisma.rodapeRelatorio.findMany).toHaveBeenCalledWith({ where: { entidadeId: 'ent1' }, orderBy: { nome: 'asc' } })
      prisma.rodapeRelatorio.findUnique.mockResolvedValue({ id: 'r1' })
      expect(await svc.buscarRodape('r1')).toEqual({ id: 'r1' })
    })

    it('cria com altura default 80 e elemento de rodapé', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      prisma.rodapeRelatorio.create.mockResolvedValue({ id: 'r1' })
      await svc.criarRodape('ent1', 'u1', { nome: 'Rodapé', layout: [{ tipo: 'ENDERECO_ENTIDADE', x: 0, y: 0 }] })
      expect(prisma.rodapeRelatorio.create).toHaveBeenCalledWith({
        data: { entidadeId: 'ent1', criadoPorId: 'u1', nome: 'Rodapé', altura: 80, layout: [{ tipo: 'ENDERECO_ENTIDADE', x: 0, y: 0 }] },
      })
    })

    it('rejeita BRASAO no rodapé (não está na allowlist)', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      await expect(svc.criarRodape('ent1', 'u1', { nome: 'X', layout: [{ tipo: 'BRASAO', x: 0, y: 0 }] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })

    it('rejeita criar em entidade inexistente', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      await expect(svc.criarRodape('ent1', 'u1', { nome: 'X', layout: [] })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })

    it('atualiza e exclui com guard de entidade', async () => {
      prisma.rodapeRelatorio.findUnique.mockResolvedValue({ id: 'r1', entidadeId: 'ent1', altura: 80 })
      prisma.rodapeRelatorio.update.mockResolvedValue({ id: 'r1' })
      await svc.atualizarRodape('r1', 'ent1', { nome: 'N', altura: 100, layout: [{ tipo: 'DATA_GERACAO', x: 0, y: 0 }] })
      expect(prisma.rodapeRelatorio.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { nome: 'N', altura: 100, layout: [{ tipo: 'DATA_GERACAO', x: 0, y: 0 }] } })

      prisma.rodapeRelatorio.delete.mockResolvedValue({ id: 'r1' })
      await svc.excluirRodape('r1', 'ent1')
      expect(prisma.rodapeRelatorio.delete).toHaveBeenCalledWith({ where: { id: 'r1' } })
    })

    it('rejeita atualizar/excluir inexistente ou de outra entidade', async () => {
      prisma.rodapeRelatorio.findUnique.mockResolvedValue(null)
      await expect(svc.atualizarRodape('r1', 'ent1', { nome: 'X', layout: [] })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
      prisma.rodapeRelatorio.findUnique.mockResolvedValue({ id: 'r1', entidadeId: 'OUTRA' })
      await expect(svc.excluirRodape('r1', 'ent1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    })

    it('rejeita layout vazio e traduz P2002 no rodapé', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      await expect(svc.criarRodape('ent1', 'u1', { nome: 'X', layout: [] })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
      prisma.rodapeRelatorio.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
      await expect(
        svc.criarRodape('ent1', 'u1', { nome: 'Dup', layout: [{ tipo: 'DATA_GERACAO', x: 0, y: 0 }] }),
      ).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    })
  })

  it('erros são instâncias de ErroNegocio', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(svc.criarCabecalho('x', 'u', { nome: 'a', layout: [] })).rejects.toBeInstanceOf(ErroNegocio)
  })
})
