import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { PreviewMemoriaisService } from '../preview-memoriais.js'

describe('PreviewMemoriaisService.calcular', () => {
  let prisma: PrismaMock
  let svc: PreviewMemoriaisService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new PreviewMemoriaisService(prisma as never)
    prisma.entidade.findUnique.mockResolvedValue({
      nome: 'Prefeitura',
      municipio: { nome: 'Maringá', estado: { sigla: 'PR', rclComposicao: null, fonteClassificacao: null, pessoalComposicao: null } },
    })
    prisma.orcamento.findUnique.mockResolvedValue(null) // sem orçamento → serviços retornam vazio (números 0)
  })

  it('entidade inexistente → null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect(await svc.calcular({ entidadeId: 'x', ano: 2026 })).toBeNull()
  })

  it('proposto usa a composição editada; efetivo usa a do Estado (default PR)', async () => {
    const r = await svc.calcular({
      entidadeId: 'e1',
      ano: 2026,
      rcl: { nome: 'Minha RCL', deducoes: [{ rotulo: 'X', prefixos: ['1.7'] }] },
      pessoal: { nome: 'Meu Pessoal', inclusoes: [{ rotulo: 'P', prefixos: ['3.1'] }], exclusoes: [] },
    })
    expect(r).not.toBeNull()
    expect(r!.temOrcamento).toBe(false)
    expect(r!.entidade).toEqual({ nome: 'Prefeitura', municipio: 'Maringá', estado: 'PR' })
    expect(r!.rcl.proposto.metodologia).toBe('Minha RCL')
    expect(r!.rcl.efetivo.metodologia).toContain('TCE-PR') // default do PR
    expect(r!.pessoal.proposto.metodologia).toBe('Meu Pessoal')
    expect(r!.rcl.proposto.rcl).toBe(0) // sem orçamento
  })

  it('composição inválida cai no efetivo (mesma metodologia)', async () => {
    const r = await svc.calcular({ entidadeId: 'e1', ano: 2026, rcl: 'lixo', pessoal: { inclusoes: [] } })
    expect(r!.rcl.proposto.metodologia).toBe(r!.rcl.efetivo.metodologia)
    expect(r!.pessoal.proposto.metodologia).toBe(r!.pessoal.efetivo.metodologia)
  })

  it('é READ-ONLY: nunca abre transação nem grava', async () => {
    await svc.calcular({ entidadeId: 'e1', ano: 2026 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.estado.update).not.toHaveBeenCalled()
    expect(prisma.arrecadacao.create).not.toHaveBeenCalled()
  })
})
