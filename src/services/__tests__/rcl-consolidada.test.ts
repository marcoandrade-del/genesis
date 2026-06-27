import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { RclConsolidadaService } from '../rcl-consolidada.js'

const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

describe('RclConsolidadaService.calcular', () => {
  let prisma: PrismaMock
  let svc: RclConsolidadaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new RclConsolidadaService(prisma as never)
  })

  it('soma as entidades do município (só as que têm orçamento contribuem)', async () => {
    prisma.municipio.findUnique.mockResolvedValue({
      estado: { sigla: 'PR' },
      entidades: [
        { id: 'e1', nome: 'Prefeitura' },
        { id: 'e2', nome: 'Câmara' },
      ],
    })
    // e1 tem orçamento; e2 não.
    prisma.orcamento.findUnique.mockImplementation(({ where }: { where: { entidadeId_ano: { entidadeId: string } } }) =>
      Promise.resolve(where.entidadeId_ano.entidadeId === 'e1' ? { id: 'o1' } : null),
    )
    prisma.previsaoReceita.findMany.mockResolvedValue([{ valorPrevisto: dec(1000), contaReceita: { codigo: '1.1.1.0.00' } }])

    const r = await svc.calcular('mun1', 2026)
    expect(r.entidades.map((e) => [e.nome, e.temOrcamento])).toEqual([
      ['Prefeitura', true],
      ['Câmara', false],
    ])
    expect(r.correntesTotal.toString()).toBe('1000')
    expect(r.intra.toString()).toBe('0')
    expect(r.rclTotal.toString()).toBe('1000')
    expect(r.metodologia).toContain('TCE-PR')
  })

  it('município inexistente → consolidado vazio (STN)', async () => {
    prisma.municipio.findUnique.mockResolvedValue(null)
    const r = await svc.calcular('munX', 2026)
    expect(r.entidades).toEqual([])
    expect(r.rclTotal.toString()).toBe('0')
    expect(r.metodologia).toContain('STN')
  })
})
