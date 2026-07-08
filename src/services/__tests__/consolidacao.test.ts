import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { ConsolidacaoService } from '../consolidacao.js'

const D = (n: number) => new Prisma.Decimal(n)
// movimento com a natureza da dotação (só o que o service seleciona)
const mov = (tipo: string, valor: number, conta: string) => ({
  tipo,
  valor: D(valor),
  empenho: { dotacaoDespesa: { contaDespesa: { codigo: conta } } },
})

describe('ConsolidacaoService.despesa', () => {
  let prisma: PrismaMock
  let svc: ConsolidacaoService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new ConsolidacaoService(prisma as never)
  })

  it('elimina a intra (modalidade 91): consolidado = bruto − intra', async () => {
    prisma.municipio.findUnique.mockResolvedValue({
      entidades: [
        { id: 'pref', nome: 'Prefeitura' },
        { id: 'prev', nome: 'Previdência' },
      ],
    })
    prisma.movimentoEmpenho.findMany.mockImplementation(({ where }: { where: { entidadeId: string } }) => {
      if (where.entidadeId === 'pref')
        return Promise.resolve([
          mov('EMPENHO', 100, '3.3.90.39.00.00'), // direta
          mov('EMPENHO', 44, '3.1.91.13.00.00'), // INTRA → contribuição patronal ao RPPS
        ])
      // Previdência recebe/aplica; sem despesa intra própria relevante
      return Promise.resolve([mov('EMPENHO', 30, '3.1.90.11.00.00')])
    })

    const r = await svc.despesa('mun', 2026)

    expect(r.empenhadoBruto.toNumber()).toBe(174) // 100+44+30
    expect(r.intraEliminada.toNumber()).toBe(44) // só o 91
    expect(r.empenhadoConsolidado.toNumber()).toBe(130) // 174 − 44 (o repasse não conta 2×)
    expect(r.entidades[0]!.intraEmpenhado.toNumber()).toBe(44)
    expect(r.entidades[1]!.intraEmpenhado.toNumber()).toBe(0)
  })

  it('estorno de empenho reduz bruto e intra com sinal', async () => {
    prisma.municipio.findUnique.mockResolvedValue({ entidades: [{ id: 'e1', nome: 'E1' }] })
    prisma.movimentoEmpenho.findMany.mockResolvedValue([
      mov('EMPENHO', 50, '3.1.91.13.00.00'),
      mov('ESTORNO_EMPENHO', 20, '3.1.91.13.00.00'),
    ])
    const r = await svc.despesa('mun', 2026)
    expect(r.empenhadoBruto.toNumber()).toBe(30)
    expect(r.intraEliminada.toNumber()).toBe(30)
    expect(r.empenhadoConsolidado.toNumber()).toBe(0)
  })

  it('município sem entidades → tudo zero', async () => {
    prisma.municipio.findUnique.mockResolvedValue({ entidades: [] })
    const r = await svc.despesa('mun', 2026)
    expect(r.empenhadoBruto.toNumber()).toBe(0)
    expect(r.empenhadoConsolidado.toNumber()).toBe(0)
    expect(r.entidades).toEqual([])
  })
})

describe('ConsolidacaoService.receita', () => {
  let prisma: PrismaMock
  let svc: ConsolidacaoService
  const prev = (valorArrecadado: number, codigo: string) => ({ valorArrecadado: D(valorArrecadado), contaReceita: { codigo } })

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new ConsolidacaoService(prisma as never)
  })

  it('elimina a receita intra (categoria 7): consolidado = bruto − intra', async () => {
    prisma.municipio.findUnique.mockResolvedValue({
      entidades: [
        { id: 'pref', nome: 'Prefeitura' },
        { id: 'rpps', nome: 'Previdência' },
      ],
    })
    prisma.orcamento.findUnique.mockImplementation(({ where }: { where: { entidadeId_ano: { entidadeId: string } } }) =>
      Promise.resolve({ id: `orc-${where.entidadeId_ano.entidadeId}` }),
    )
    prisma.previsaoReceita.findMany.mockImplementation(({ where }: { where: { orcamentoId: string } }) => {
      if (where.orcamentoId === 'orc-pref') return Promise.resolve([prev(1000, '1.1.1.2.01.0.1.07')]) // imposto (corrente)
      // RPPS: contribuição do servidor (cat 1) + contribuição patronal INTRA (cat 7)
      return Promise.resolve([prev(300, '1.2.1.5.01.1.1.02.01'), prev(44, '7.2.1.5.02.1.1.02.01')])
    })

    const r = await svc.receita('mun', 2026)
    expect(r.arrecadadoBruto.toNumber()).toBe(1344) // 1000+300+44
    expect(r.intraEliminada.toNumber()).toBe(44) // só a cat 7
    expect(r.arrecadadoConsolidado.toNumber()).toBe(1300) // repasse não conta 2×
    expect(r.entidades[1]!.intraArrecadado.toNumber()).toBe(44)
  })

  it('entidade sem orçamento → contribui zero', async () => {
    prisma.municipio.findUnique.mockResolvedValue({ entidades: [{ id: 'e1', nome: 'E1' }] })
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.receita('mun', 2026)
    expect(r.arrecadadoBruto.toNumber()).toBe(0)
    expect(r.entidades[0]!.arrecadado.toNumber()).toBe(0)
  })
})
