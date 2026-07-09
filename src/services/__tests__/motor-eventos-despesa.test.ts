import { describe, it, expect, beforeEach } from 'vitest'
import { MotorEventosDespesa, CONTAS_DESPESA as C } from '../motor-eventos-despesa.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { mockMatrizDespesa } from './helpers/despesa-matriz.js'

const VPD = '3.3.2.1.1.01.00.00.00.00.00.00'
const PASSIVO = '2.1.3.1.1.01.00.00.00.00.00.00'
const CAIXA = '1.1.1.1.1.01.00.00.00.00.00.00'
const ctx = { entidadeId: 'ent1', ano: 2026, dotacaoDespesaId: 'dot1', naturezaCodigo: '3.3.90.30.00.00', valor: '1000' }

let prisma: PrismaMock
let motor: MotorEventosDespesa

beforeEach(() => {
  prisma = criarPrismaMock()
  motor = new MotorEventosDespesa(prisma as never)
  prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1', municipio: { modeloContabilId: 'm1', estado: { modeloContabilId: 'm1' } } } as never)
  mockMatrizDespesa(prisma) // matriz de eventos vinda da "tabela" (configurável)
})

function mockContas(extras: string[] = []) {
  const codigos = [...Object.values(C), ...extras]
  prisma.contaContabilEntidade.findMany.mockResolvedValue(codigos.map((codigo) => ({ id: 'c-' + codigo, codigo, admiteMovimento: true })) as never)
}
function comDePara() {
  prisma.parametroDespesa.findMany.mockResolvedValue([{ naturezaCodigo: '3.3.90', contaVpdCodigo: VPD, contaPassivoCodigo: PASSIVO }] as never)
}
const deb = (e: { itens: { tipo: string; contaId: string }[] }) => e.itens.find((i) => i.tipo === 'DEBITO')!.contaId
const cred = (e: { itens: { tipo: string; contaId: string }[] }) => e.itens.find((i) => i.tipo === 'CREDITO')!.contaId

describe('MotorEventosDespesa (table-driven)', () => {
  it('empenho → lê 6xx da matriz: orçamentário + DDR (D/C, cc=dotação, valor 2 casas)', async () => {
    mockContas()
    const ev = await motor.resolverEmpenho(ctx)
    expect(ev.map((e) => e.eventoCodigo)).toEqual(['600', '601'])
    expect(deb(ev[0])).toBe('c-' + C.creditoDisponivel)
    expect(cred(ev[0])).toBe('c-' + C.empenhadoALiquidar)
    expect(deb(ev[1])).toBe('c-' + C.ddrDisponivel)
    expect(cred(ev[1])).toBe('c-' + C.ddrComprEmpenho)
    expect(ev[0].itens.every((i) => i.dotacaoDespesaId === 'dot1' && i.valor === '1000.00')).toBe(true)
  })

  it('carimba a fonte da dotação em todas as pernas (dimensão da MSC/RGF)', async () => {
    mockContas()
    prisma.dotacaoDespesa.findUnique.mockResolvedValue({ fonteRecurso: { codigo: '1500' } } as never)
    const ev = await motor.resolverEmpenho(ctx)
    expect(ev.flatMap((e) => e.itens).every((i) => i.fonteCodigo === '1500')).toBe(true)
  })

  it('fonte null quando a dotação não tem fonte resolvível (comportamento anterior preservado)', async () => {
    mockContas()
    // dotacaoDespesa.findUnique não mockado → undefined → fonteCodigo null
    const ev = await motor.resolverEmpenho(ctx)
    expect(ev.flatMap((e) => e.itens).every((i) => i.fonteCodigo == null)).toBe(true)
  })

  it('liquidação COM de/para → 700/701 + 702 patrimonial (token @VPD/@PASSIVO resolvido)', async () => {
    comDePara()
    mockContas([VPD, PASSIVO])
    const ev = await motor.resolverLiquidacao(ctx)
    expect(ev.map((e) => e.eventoCodigo)).toEqual(['700', '701', '702'])
    expect(deb(ev[0])).toBe('c-' + C.empenhadoALiquidar)
    expect(cred(ev[0])).toBe('c-' + C.liquidadoAPagar)
    expect(deb(ev[2])).toBe('c-' + VPD)
    expect(cred(ev[2])).toBe('c-' + PASSIVO)
  })

  it('liquidação SEM de/para → token @VPD não resolve → pula 702 (só 700/701)', async () => {
    mockContas()
    const ev = await motor.resolverLiquidacao(ctx)
    expect(ev.map((e) => e.eventoCodigo)).toEqual(['700', '701'])
  })

  it('pagamento COM de/para + caixa → 800/801 + 802 financeiro (token @PASSIVO/@CAIXA)', async () => {
    comDePara()
    mockContas([PASSIVO, CAIXA])
    const ev = await motor.resolverPagamento({ ...ctx, caixaCodigo: CAIXA })
    expect(ev.map((e) => e.eventoCodigo)).toEqual(['800', '801', '802'])
    expect(deb(ev[0])).toBe('c-' + C.liquidadoAPagar)
    expect(cred(ev[0])).toBe('c-' + C.pago)
    expect(deb(ev[2])).toBe('c-' + PASSIVO)
    expect(cred(ev[2])).toBe('c-' + CAIXA)
  })

  it('pagamento sem caixa → token @CAIXA não resolve → pula 802', async () => {
    comDePara()
    mockContas([PASSIVO])
    const ev = await motor.resolverPagamento(ctx) // sem caixaCodigo
    expect(ev.map((e) => e.eventoCodigo)).toEqual(['800', '801'])
  })

  it('estorno inverte cada par D↔C', async () => {
    mockContas()
    const ev = await motor.resolverEmpenho(ctx, { estorno: true })
    expect(deb(ev[0])).toBe('c-' + C.empenhadoALiquidar) // antes era crédito
    expect(cred(ev[0])).toBe('c-' + C.creditoDisponivel) // antes era débito
  })

  it('conta literal ausente no plano da entidade → ENTIDADE_NAO_PROCESSAVEL (rollback)', async () => {
    prisma.contaContabilEntidade.findMany.mockResolvedValue([] as never)
    await expect(motor.resolverEmpenho(ctx)).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
  })

  it('modelo sem eventos do estágio → nada a lançar (lista vazia)', async () => {
    prisma.eventoContabil.findMany.mockResolvedValue([] as never)
    expect(await motor.resolverEmpenho(ctx)).toEqual([])
  })
})
