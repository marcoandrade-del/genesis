import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { CreditosAdicionaisService } from '../creditos-adicionais.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: CreditosAdicionaisService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new CreditosAdicionaisService(prisma as never)
})

const ORC = { id: 'o1', entidadeId: 'ent1', ano: 2026, status: 'EM_EXECUCAO' }
const DOT_A = { id: 'dA', valorAutorizado: '1000', valorReservado: '0', valorEmpenhado: '0' } // saldo 1000
const DOT_B = { id: 'dB', valorAutorizado: '500', valorReservado: '100', valorEmpenhado: '50' } // saldo 350

const baseDados = (over = {}) => ({
  tipo: 'SUPLEMENTAR',
  numero: '1/2026',
  data: '2026-06-01',
  atoLegal: 'Lei 1.234/2026',
  justificativa: 'reforço de saúde',
  itens: [
    { dotacaoId: 'dA', operacao: 'REFORCO', valor: '300' },
    { dotacaoId: 'dB', operacao: 'ANULACAO', valor: '300' },
  ],
  ...over,
})

describe('CreditosAdicionaisService.criar', () => {
  it('aplica reforço (+) e anulação (−) no valorAutorizado das dotações', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    prisma.dotacaoDespesa.findMany.mockResolvedValue([DOT_A, DOT_B])
    prisma.creditoAdicional.create.mockResolvedValue({ id: 'cr1' })

    await service.criar('o1', baseDados())

    const dataCriar = prisma.creditoAdicional.create.mock.calls[0][0].data
    expect(dataCriar.numero).toBe('1/2026')
    expect(dataCriar.valorTotal.toString()).toBe('300') // soma dos reforços
    expect(dataCriar.itens.create).toHaveLength(2)

    expect(prisma.dotacaoDespesa.update).toHaveBeenCalledTimes(2)
    const upd = prisma.dotacaoDespesa.update.mock.calls
    expect(upd[0][0].where).toEqual({ id: 'dA' })
    expect(upd[0][0].data.valorAutorizado.increment.toString()).toBe('300')
    expect(upd[1][0].where).toEqual({ id: 'dB' })
    expect(upd[1][0].data.valorAutorizado.decrement.toString()).toBe('300')
  })

  it('aceita decreto SÓ de anulação (contingenciamento) e anulação > reforço (remanejamento)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    prisma.dotacaoDespesa.findMany.mockResolvedValue([DOT_A, DOT_B])
    prisma.creditoAdicional.create.mockResolvedValue({ id: 'cr1' })
    // só anulação
    await service.criar('o1', baseDados({ itens: [{ dotacaoId: 'dB', operacao: 'ANULACAO', valor: '300' }] }))
    // anulação maior que o reforço
    await service.criar(
      'o1',
      baseDados({
        numero: '2/2026',
        itens: [
          { dotacaoId: 'dA', operacao: 'REFORCO', valor: '10' },
          { dotacaoId: 'dB', operacao: 'ANULACAO', valor: '300' },
        ],
      }),
    )
    expect(prisma.creditoAdicional.create).toHaveBeenCalledTimes(2)
  })

  it('rejeita orçamento em rascunho', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ ...ORC, status: 'RASCUNHO' })
    await expect(service.criar('o1', baseDados())).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.creditoAdicional.create).not.toHaveBeenCalled()
  })

  it('rejeita quando o orçamento não existe', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    await expect(service.criar('xx', baseDados())).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('rejeita sem itens', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    await expect(service.criar('o1', baseDados({ itens: [] }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita valor não positivo', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    const dados = baseDados({ itens: [{ dotacaoId: 'dA', operacao: 'REFORCO', valor: '0' }] })
    await expect(service.criar('o1', dados)).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita crédito sem itens', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    const dados = baseDados({ itens: [] })
    await expect(service.criar('o1', dados)).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.creditoAdicional.create).not.toHaveBeenCalled()
  })

  it('rejeita anulação acima do saldo disponível da dotação-fonte', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    prisma.dotacaoDespesa.findMany.mockResolvedValue([DOT_A, DOT_B])
    const dados = baseDados({
      itens: [
        { dotacaoId: 'dA', operacao: 'REFORCO', valor: '400' },
        { dotacaoId: 'dB', operacao: 'ANULACAO', valor: '400' }, // saldo dB = 350
      ],
    })
    await expect(service.criar('o1', dados)).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
  })

  it('rejeita dotação que não pertence ao orçamento', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    prisma.dotacaoDespesa.findMany.mockResolvedValue([DOT_A]) // dB ausente
    await expect(service.criar('o1', baseDados())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('traduz P2002 (número duplicado) para CONFLITO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(ORC)
    prisma.dotacaoDespesa.findMany.mockResolvedValue([DOT_A, DOT_B])
    prisma.creditoAdicional.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' }),
    )
    await expect(service.criar('o1', baseDados())).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('CreditosAdicionaisService.listar', () => {
  it('lista por orçamento ordenado por data/número desc', async () => {
    prisma.creditoAdicional.findMany.mockResolvedValue([{ id: 'cr1' }])
    const r = await service.listar('o1')
    expect(r).toHaveLength(1)
    expect(prisma.creditoAdicional.findMany).toHaveBeenCalledWith({
      where: { orcamentoId: 'o1' },
      orderBy: [{ data: 'desc' }, { numero: 'desc' }],
      include: { _count: { select: { itens: true } } },
    })
  })
})
