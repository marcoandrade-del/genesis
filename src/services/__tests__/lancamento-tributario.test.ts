import { describe, it, expect, beforeEach } from 'vitest'
import { LancamentoTributarioService } from '../lancamento-tributario.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ATIVO = '1.1.2.1.1.01.05.00.00.00.00.00'
const VPA = '4.1.1.2.1.02.00.00.00.00.00.00'
const NAT = '1.1.1.2.50.0.1.00.00.00.00.00'

let prisma: PrismaMock
let svc: LancamentoTributarioService

beforeEach(() => {
  prisma = criarPrismaMock()
  svc = new LancamentoTributarioService(prisma as never)
})

/** Arma os mocks para o criar rodar até o fim (disparo E550 dentro da transação). */
function armar() {
  prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', entidadeId: 'ent1', status: 'APROVADO' })
  prisma.previsaoReceita.findUnique.mockResolvedValue({ id: 'p1', orcamentoId: 'o1', contaReceita: { codigo: NAT } })
  prisma.lancamentoTributario.create.mockResolvedValue({ id: 'lt1' })
  prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1', municipio: { modeloContabilId: null, estado: { modeloContabilId: 'mod' } } })
  prisma.parametroReceita.findMany.mockResolvedValue([
    { naturezaCodigo: '1.1.1.2.50.0.1', tipoMutacao: 'EFETIVA', indicadorReconhecimento: 'COMPETENCIA', contaContrapartidaCodigo: VPA, contaAtivoCodigo: ATIVO },
  ])
  prisma.contaContabilEntidade.findMany.mockImplementation(({ where }: any) => {
    if (where?.codigo?.in) return Promise.resolve(where.codigo.in.map((codigo: string) => ({ id: `id:${codigo}`, codigo, admiteMovimento: true })))
    if (where?.id?.in) return Promise.resolve(where.id.in.map((id: string) => ({ id, codigo: id, admiteMovimento: true, entidadeId: 'ent1', ano: 2026 })))
    return Promise.resolve([])
  })
  prisma.lancamento.create.mockResolvedValue({ id: 'lc1' })
}

const dados = (over = {}) => ({ previsaoId: 'p1', data: '2026-06-10', valor: '500', criadoPorId: 'u1', ...over })

describe('LancamentoTributarioService.criar', () => {
  it('constitui o crédito e dispara E550 (D ativo / C VPA), origem LANCAMENTO_TRIBUTARIO', async () => {
    armar()
    await svc.criar('o1', dados())
    expect(prisma.lancamentoTributario.create).toHaveBeenCalled()
    expect(prisma.lancamento.create).toHaveBeenCalledTimes(1)
    const lc = prisma.lancamento.create.mock.calls[0][0].data
    expect(lc.origemTipo).toBe('LANCAMENTO_TRIBUTARIO')
    expect(lc.origemId).toBe('lt1')
    expect(lc.eventoCodigo).toBe('550')
    const itens = prisma.lancamentoItem.createMany.mock.calls[0][0].data
    expect(itens.find((i: any) => i.tipo === 'DEBITO').contaId).toBe(`id:${ATIVO}`)
    expect(itens.find((i: any) => i.tipo === 'CREDITO').contaId).toBe(`id:${VPA}`)
  })

  it('rejeita natureza não-tributária (sem parâmetro de competência)', async () => {
    armar()
    prisma.parametroReceita.findMany.mockResolvedValue([]) // nenhuma config
    await expect(svc.criar('o1', dados())).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
  })

  it('valida orçamento (rascunho/inexistente), previsão, valor e data', async () => {
    armar()
    prisma.orcamento.findUnique.mockResolvedValueOnce({ id: 'o1', entidadeId: 'ent1', status: 'RASCUNHO' })
    await expect(svc.criar('o1', dados())).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    await expect(svc.criar('o1', dados({ valor: '0' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(svc.criar('o1', dados({ data: 'xx' }))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    prisma.previsaoReceita.findUnique.mockResolvedValueOnce({ id: 'p1', orcamentoId: 'OUTRO', contaReceita: { codigo: NAT } })
    await expect(svc.criar('o1', dados())).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
})

describe('LancamentoTributarioService.excluir', () => {
  it('reverte os lançamentos contábeis e remove o lançamento', async () => {
    prisma.lancamentoTributario.findUnique.mockResolvedValue({ id: 'lt1', previsao: { orcamento: { entidadeId: 'ent1' } } })
    prisma.lancamento.findMany.mockResolvedValue([{ id: 'lc1' }])
    prisma.lancamento.findUnique.mockResolvedValue({ id: 'lc1', entidadeId: 'ent1', data: new Date('2026-06-10'), itens: [] })
    await svc.excluir('lt1', 'ent1')
    expect(prisma.lancamento.delete).toHaveBeenCalledWith({ where: { id: 'lc1' } })
    expect(prisma.lancamentoTributario.delete).toHaveBeenCalledWith({ where: { id: 'lt1' } })
  })

  it('rejeita lançamento de outra entidade', async () => {
    prisma.lancamentoTributario.findUnique.mockResolvedValue({ id: 'lt1', previsao: { orcamento: { entidadeId: 'OUTRA' } } })
    await expect(svc.excluir('lt1', 'ent1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})
