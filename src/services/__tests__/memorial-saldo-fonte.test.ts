import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MemorialSaldoFonteService } from '../memorial-saldo-fonte.js'

describe('MemorialSaldoFonteService.saldoFonte', () => {
  let prisma: PrismaMock
  let svc: MemorialSaldoFonteService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new MemorialSaldoFonteService(prisma as never)
  })

  it('entidade inexistente → null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    expect(await svc.saldoFonte('x', 2026)).toBeNull()
  })

  it('mapeia a entidade e a metodologia; sem orçamento → receita/despesa vazias', async () => {
    prisma.entidade.findUnique.mockResolvedValue({
      id: 'e1',
      nome: 'Prefeitura de Maringá',
      municipio: { nome: 'Maringá', estado: { sigla: 'PR', fonteClassificacao: null } },
    })
    prisma.orcamento.findUnique.mockResolvedValue(null) // ArrecadacoesService e SaldoOrcamentarioService → vazio

    const r = await svc.saldoFonte('e1', 2026)
    expect(r).not.toBeNull()
    expect(r!.entidade).toEqual({ id: 'e1', nome: 'Prefeitura de Maringá', municipio: 'Maringá', estado: 'PR' })
    expect(r!.metodologia).toContain('TCE-PR') // classificação do PR resolvida
    expect(r!.receita).toEqual({ temOrcamento: false, porFinalidade: [], total: 0 })
    expect(r!.despesa).toEqual({ temOrcamento: false, porFinalidade: [], total: 0 })
  })
})
