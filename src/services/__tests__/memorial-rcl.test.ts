import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MemorialRclService } from '../memorial-rcl.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

describe('MemorialRclService', () => {
  let prisma: PrismaMock
  let svc: MemorialRclService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new MemorialRclService(prisma as never)
  })

  it('rcl: payload pronto (inputs + deduções + total) em números', async () => {
    prisma.entidade.findUnique.mockResolvedValue({
      id: 'e1',
      nome: 'Prefeitura',
      municipio: { nome: 'Maringá', estado: { sigla: 'PR', rclComposicao: null } },
    })
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([
      { valorPrevisto: dec(1000), contaReceita: { codigo: '1.1.1.0.00' } },
      { valorPrevisto: dec(277), contaReceita: { codigo: '1.7.5.1.50' } }, // FUNDEB — PR deduz
    ])
    const r = await svc.rcl('e1', 2026)
    expect(r!.entidade).toEqual({ id: 'e1', nome: 'Prefeitura', municipio: 'Maringá', estado: 'PR' })
    expect(r!.metodologia).toContain('TCE-PR')
    expect(r!.correntesTotal).toBe(1277)
    expect(r!.deducoesTotal).toBe(277)
    expect(r!.rcl).toBe(1000)
    expect(typeof r!.rcl).toBe('number')
  })

  it('rcl: entidade inexistente → null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect(await svc.rcl('x', 2026)).toBeNull()
  })

  it('rclConsolidada: soma as entidades do município', async () => {
    prisma.entidade.findUnique.mockResolvedValue({
      municipioId: 'mun1',
      municipio: { nome: 'Maringá', estado: { sigla: 'PR' } },
    })
    prisma.municipio.findUnique.mockResolvedValue({
      estado: { sigla: 'PR', rclComposicao: null },
      entidades: [{ id: 'e1', nome: 'Prefeitura' }],
    })
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1' })
    prisma.previsaoReceita.findMany.mockResolvedValue([{ valorPrevisto: dec(500), contaReceita: { codigo: '1.1.1.0.00' } }])
    const r = await svc.rclConsolidada('e1', 2026)
    expect(r!.municipio).toBe('Maringá')
    expect(r!.rclTotal).toBe(500)
    expect(r!.entidades[0]!.nome).toBe('Prefeitura')
  })

  it('rclConsolidada: entidade inexistente → null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect(await svc.rclConsolidada('x', 2026)).toBeNull()
  })
})
