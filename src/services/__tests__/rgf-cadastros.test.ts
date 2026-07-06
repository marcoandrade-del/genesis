import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { RgfCadastrosService } from '../rgf-cadastros.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

describe('RgfCadastrosService', () => {
  let prisma: PrismaMock
  let svc: RgfCadastrosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new RgfCadastrosService(prisma as never)
  })

  describe('criarDivida', () => {
    it('grava categoria + descrição + saldo (aceita vírgula pt-BR)', async () => {
      prisma.dividaItem.create.mockResolvedValue({})
      await svc.criarDivida('e1', 2026, { categoria: 'CONTRATUAL', descricao: 'Financiamento CAIXA', valorSaldo: '1.234,56' })
      expect(prisma.dividaItem.create).toHaveBeenCalledWith({
        data: { entidadeId: 'e1', ano: 2026, categoria: 'CONTRATUAL', descricao: 'Financiamento CAIXA', valorSaldo: 1234.56 },
      })
    })
    it('rejeita categoria inválida, descrição vazia e valor negativo', async () => {
      await expect(svc.criarDivida('e1', 2026, { categoria: 'X', descricao: 'd', valorSaldo: 1 })).rejects.toThrow('Categoria')
      await expect(svc.criarDivida('e1', 2026, { categoria: 'DEMAIS', descricao: ' ', valorSaldo: 1 })).rejects.toThrow('Informe')
      await expect(svc.criarDivida('e1', 2026, { categoria: 'DEMAIS', descricao: 'd', valorSaldo: -5 })).rejects.toThrow('Valor')
    })
  })

  describe('excluirDivida', () => {
    it('404 quando o item é de outra entidade', async () => {
      prisma.dividaItem.findUnique.mockResolvedValue({ entidadeId: 'OUTRA' })
      await expect(svc.excluirDivida('e1', 'd1')).rejects.toThrow('não encontrado')
    })
    it('exclui quando pertence à entidade', async () => {
      prisma.dividaItem.findUnique.mockResolvedValue({ entidadeId: 'e1' })
      prisma.dividaItem.delete.mockResolvedValue({})
      await svc.excluirDivida('e1', 'd1')
      expect(prisma.dividaItem.delete).toHaveBeenCalledWith({ where: { id: 'd1' } })
    })
  })

  describe('criarGarantia / criarOperacao', () => {
    it('garantia: contragarantia vazia vira 0', async () => {
      prisma.garantia.create.mockResolvedValue({})
      await svc.criarGarantia('e1', 2026, { tipo: 'INTERNA', beneficiario: 'SAAE', valor: '100', contragarantia: '' })
      expect(prisma.garantia.create.mock.calls[0]![0]!.data.contragarantia).toBe(0)
    })
    it('operação: data inválida rejeita; tipo ARO aceito', async () => {
      await expect(svc.criarOperacao('e1', 2026, { tipo: 'ARO', credor: 'BB', valor: 10, data: 'xx' })).rejects.toThrow('Data')
      prisma.operacaoCredito.create.mockResolvedValue({})
      await svc.criarOperacao('e1', 2026, { tipo: 'ARO', credor: 'BB', valor: 10, data: '2026-03-01' })
      expect(prisma.operacaoCredito.create.mock.calls[0]![0]!.data.tipo).toBe('ARO')
    })
  })

  describe('totais', () => {
    it('agrupa dívida por categoria, garantias por tipo e operações por sujeição ao limite', async () => {
      prisma.dividaItem.findMany.mockResolvedValue([
        { categoria: 'CONTRATUAL', valorSaldo: dec(300) },
        { categoria: 'CONTRATUAL', valorSaldo: dec(200) },
        { categoria: 'PRECATORIOS', valorSaldo: dec(44.32) },
      ])
      prisma.garantia.findMany.mockResolvedValue([
        { tipo: 'INTERNA', valor: dec(50), contragarantia: dec(50) },
        { tipo: 'EXTERNA', valor: dec(10), contragarantia: dec(0) },
      ])
      prisma.operacaoCredito.findMany.mockResolvedValue([
        { tipo: 'CONTRATUAL_INTERNA', valor: dec(100) },
        { tipo: 'MOBILIARIA', valor: dec(20) },
        { tipo: 'ARO', valor: dec(30) },
        { tipo: 'REESTRUTURACAO', valor: dec(5) },
      ])
      const t = await svc.totais('e1', 2026)
      expect(t.divida.total).toBe(544.32)
      expect(t.divida.porCategoria.find((c) => c.categoria === 'CONTRATUAL')!.total).toBe(500)
      expect(t.garantias.total).toBe(60)
      expect(t.garantias.contragarantias).toBe(50)
      expect(t.operacoes.sujeitas).toBe(120)
      expect(t.operacoes.aro).toBe(30)
      expect(t.operacoes.naoSujeitas).toBe(5)
      expect(t.operacoes.total).toBe(155)
      expect(t.operacoes.porTipo.find((p) => p.tipo === 'CONTRATUAL_INTERNA')).toEqual({ tipo: 'CONTRATUAL_INTERNA', rotulo: 'Contratual interna', sujeitaLimite: true, total: 100 })
      expect(t.operacoes.porTipo.find((p) => p.tipo === 'ARO')!.total).toBe(30)
    })

    it('corte de período filtra as operações (lte fimPeriodo)', async () => {
      prisma.dividaItem.findMany.mockResolvedValue([])
      prisma.garantia.findMany.mockResolvedValue([])
      prisma.operacaoCredito.findMany.mockResolvedValue([])
      const fim = new Date(Date.UTC(2026, 3, 30))
      await svc.totais('e1', 2026, fim)
      const call = prisma.operacaoCredito.findMany.mock.calls.find((c) => c[0]?.select)
      expect(call![0]!.where.data.lte).toEqual(fim)
    })

    it('tudo vazio → totais zero (demonstrativos nascem funcionais)', async () => {
      const t = await svc.totais('e1', 2026)
      expect(t.divida.total).toBe(0)
      expect(t.garantias.total).toBe(0)
      expect(t.operacoes.total).toBe(0)
    })
  })
})
