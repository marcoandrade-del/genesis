import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient, Prisma } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MotorEventosReceita, CONTAS_EVENTO } from '../motor-eventos-receita.js'
import { mockMatrizReceita } from './helpers/receita-matriz.js'

const MODELO = 'modelo-pr'
const ENT = 'ent-1'
const ANO = 2026
const VPA_APLIC = '4.4.5.2.1.00.00.00.00.00.00.00'

// Todas as folhas que o motor pode pedir → vira {id, codigo, admiteMovimento}.
const TODAS_FOLHAS = [
  CONTAS_EVENTO.caixaArrecadacao,
  CONTAS_EVENTO.receitaARealizar,
  CONTAS_EVENTO.receitaRealizada,
  CONTAS_EVENTO.ddrControleOrdinario,
  CONTAS_EVENTO.ddrControleVinculado,
  CONTAS_EVENTO.ddrDisponibilidade,
  VPA_APLIC,
]

function comFolhas(mock: PrismaMock, folhas: string[] = TODAS_FOLHAS) {
  mock.entidade.findUnique.mockResolvedValue({
    id: ENT,
    municipio: { modeloContabilId: null, estado: { modeloContabilId: MODELO } },
  })
  mock.contaContabilEntidade.findMany.mockImplementation(({ where }: any) => {
    const pedidos: string[] = where.codigo.in
    return Promise.resolve(
      folhas.filter((c) => pedidos.includes(c)).map((codigo) => ({ id: `id:${codigo}`, codigo, admiteMovimento: true })),
    )
  })
  mockMatrizReceita(mock) // contas D/C da arrecadação vêm da "tabela"
}

function motor(mock: PrismaMock) {
  return new MotorEventosReceita(mock as unknown as PrismaClient)
}

const baseCtx = {
  entidadeId: ENT,
  ano: ANO,
  naturezaCodigo: '1.3.2.1.01.1.1.05.00.00.00.00',
  fonteCodigo: '1000',
  fonteVinculada: false,
  valor: '1000.00',
}

describe('MotorEventosReceita', () => {
  let mock: PrismaMock
  beforeEach(() => {
    mock = criarPrismaMock()
  })

  it('natureza EFETIVA gera E100 + E200 + E300, todos balanceados', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaContrapartidaCodigo: VPA_APLIC },
    ])

    const eventos = await motor(mock).resolver(baseCtx)

    expect(eventos.map((e) => e.eventoCodigo)).toEqual(['100', '200', '300'])
    for (const e of eventos) {
      const d = e.itens.filter((i) => i.tipo === 'DEBITO').reduce((s, i) => s + Number(i.valor), 0)
      const c = e.itens.filter((i) => i.tipo === 'CREDITO').reduce((s, i) => s + Number(i.valor), 0)
      expect(d).toBe(c) // partida dobrada por evento
      expect(d).toBe(1000)
    }
  })

  it('E100: D Receita Realizada / C Receita a Realizar, conta-corrente = natureza', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([])
    const [e100] = await motor(mock).resolver(baseCtx)
    const deb = e100.itens.find((i) => i.tipo === 'DEBITO')!
    const cred = e100.itens.find((i) => i.tipo === 'CREDITO')!
    expect(deb.contaId).toBe(`id:${CONTAS_EVENTO.receitaRealizada}`)
    expect(cred.contaId).toBe(`id:${CONTAS_EVENTO.receitaARealizar}`)
    expect(deb.naturezaReceitaCodigo).toBe(baseCtx.naturezaCodigo)
    expect(deb.fonteCodigo).toBeNull()
  })

  it('E200: débito é Recursos Ordinários quando a fonte não é vinculada; cc = fonte', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([])
    const eventos = await motor(mock).resolver(baseCtx)
    const e200 = eventos.find((e) => e.eventoCodigo === '200')!
    const deb = e200.itens.find((i) => i.tipo === 'DEBITO')!
    const cred = e200.itens.find((i) => i.tipo === 'CREDITO')!
    expect(deb.contaId).toBe(`id:${CONTAS_EVENTO.ddrControleOrdinario}`)
    expect(cred.contaId).toBe(`id:${CONTAS_EVENTO.ddrDisponibilidade}`)
    expect(deb.fonteCodigo).toBe('1000')
    expect(deb.naturezaReceitaCodigo).toBeNull()
  })

  it('E200: fonte vinculada usa Recursos Vinculados', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([])
    const eventos = await motor(mock).resolver({ ...baseCtx, fonteVinculada: true })
    const e200 = eventos.find((e) => e.eventoCodigo === '200')!
    const deb = e200.itens.find((i) => i.tipo === 'DEBITO')!
    expect(deb.contaId).toBe(`id:${CONTAS_EVENTO.ddrControleVinculado}`)
  })

  it('natureza sem parâmetro: gera só E100 + E200 (sem patrimonial)', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([])
    const eventos = await motor(mock).resolver(baseCtx)
    expect(eventos.map((e) => e.eventoCodigo)).toEqual(['100', '200'])
  })

  it('natureza NAO_EFETIVA não gera E300', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'NAO_EFETIVA', contaContrapartidaCodigo: VPA_APLIC },
    ])
    const eventos = await motor(mock).resolver(baseCtx)
    expect(eventos.map((e) => e.eventoCodigo)).toEqual(['100', '200'])
  })

  it('E300: D Caixa (cc fonte) / C VPA do de/para (cc natureza)', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaContrapartidaCodigo: VPA_APLIC },
    ])
    const eventos = await motor(mock).resolver(baseCtx)
    const e300 = eventos.find((e) => e.eventoCodigo === '300')!
    const deb = e300.itens.find((i) => i.tipo === 'DEBITO')!
    const cred = e300.itens.find((i) => i.tipo === 'CREDITO')!
    expect(deb.contaId).toBe(`id:${CONTAS_EVENTO.caixaArrecadacao}`)
    expect(deb.fonteCodigo).toBe('1000')
    expect(cred.contaId).toBe(`id:${VPA_APLIC}`)
    expect(cred.naturezaReceitaCodigo).toBe(baseCtx.naturezaCodigo)
  })

  it('estorno inverte o lado de cada perna (mesmas contas)', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaContrapartidaCodigo: VPA_APLIC },
    ])
    const eventos = await motor(mock).resolver(baseCtx, { estorno: true })
    const e100 = eventos.find((e) => e.eventoCodigo === '100')!
    // sem estorno o débito é Receita Realizada; no estorno ela vira crédito
    const realizada = e100.itens.find((i) => i.contaId === `id:${CONTAS_EVENTO.receitaRealizada}`)!
    expect(realizada.tipo).toBe('CREDITO')
  })

  it('prefixo mais longo vence no de/para', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.3', tipoMutacao: 'NAO_EFETIVA', contaContrapartidaCodigo: 'x' },
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaContrapartidaCodigo: VPA_APLIC },
    ])
    const eventos = await motor(mock).resolver(baseCtx)
    // o prefixo mais específico (1.3.2.1, EFETIVA) é o que vale → tem E300
    expect(eventos.some((e) => e.eventoCodigo === '300')).toBe(true)
  })

  it('não-efetiva op. de crédito (natureza 2.1) gera E400 creditando o passivo', async () => {
    const PASSIVO = '2.2.2.1.1.02.98.00.00.00.00.00'
    comFolhas(mock, [...TODAS_FOLHAS, PASSIVO])
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '2.1', tipoMutacao: 'NAO_EFETIVA', contaContrapartidaCodigo: PASSIVO },
    ])
    const eventos = await motor(mock).resolver({ ...baseCtx, naturezaCodigo: '2.1.1.9.99.0.1.17.00.00.00.00' })
    expect(eventos.map((e) => e.eventoCodigo)).toEqual(['100', '200', '400'])
    const e400 = eventos.find((e) => e.eventoCodigo === '400')!
    expect(e400.itens.find((i) => i.tipo === 'DEBITO')!.contaId).toBe(`id:${CONTAS_EVENTO.caixaArrecadacao}`)
    expect(e400.itens.find((i) => i.tipo === 'CREDITO')!.contaId).toBe(`id:${PASSIVO}`)
  })

  it('não-efetiva alienação (natureza 2.2) gera E500 creditando a baixa de ativo', async () => {
    const ATIVO = '1.2.3.1.1.01.01.00.00.00.00.00'
    comFolhas(mock, [...TODAS_FOLHAS, ATIVO])
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '2.2', tipoMutacao: 'NAO_EFETIVA', contaContrapartidaCodigo: ATIVO },
    ])
    const eventos = await motor(mock).resolver({ ...baseCtx, naturezaCodigo: '2.2.1.0.00.0.1.00.00.00.00.00' })
    expect(eventos.map((e) => e.eventoCodigo)).toEqual(['100', '200', '500'])
    expect(eventos.find((e) => e.eventoCodigo === '500')!.itens.find((i) => i.tipo === 'CREDITO')!.contaId).toBe(`id:${ATIVO}`)
  })

  it('não-efetiva sem caso definido (ex.: amortização 2.3) gera só E100/E200', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '2.3', tipoMutacao: 'NAO_EFETIVA', contaContrapartidaCodigo: 'x' },
    ])
    const eventos = await motor(mock).resolver({ ...baseCtx, naturezaCodigo: '2.3.1.0.00.0.1.00.00.00.00.00' })
    expect(eventos.map((e) => e.eventoCodigo)).toEqual(['100', '200'])
  })

  it('caixaCodigo (conta bancária) sobrepõe o caixa default no E300', async () => {
    const OVERRIDE = '1.1.1.1.1.99.00.00.00.00.00.00'
    comFolhas(mock, [...TODAS_FOLHAS, OVERRIDE])
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaContrapartidaCodigo: VPA_APLIC },
    ])
    const eventos = await motor(mock).resolver({ ...baseCtx, caixaCodigo: OVERRIDE })
    const e300 = eventos.find((e) => e.eventoCodigo === '300')!
    const deb = e300.itens.find((i) => i.tipo === 'DEBITO')!
    expect(deb.contaId).toBe(`id:${OVERRIDE}`)
    // caixa default NÃO foi usado
    expect(deb.contaId).not.toBe(`id:${CONTAS_EVENTO.caixaArrecadacao}`)
  })

  it('arrecadação tributária (COMPETENCIA) gera E560 baixando o ativo, sem VPA nova', async () => {
    const ATIVO = '1.1.2.1.1.01.05.00.00.00.00.00'
    comFolhas(mock, [...TODAS_FOLHAS, ATIVO])
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.1.1.2.50', tipoMutacao: 'EFETIVA', indicadorReconhecimento: 'COMPETENCIA', contaContrapartidaCodigo: '4.1.1.x', contaAtivoCodigo: ATIVO },
    ])
    const eventos = await motor(mock).resolver({ ...baseCtx, naturezaCodigo: '1.1.1.2.50.0.1.00.00.00.00.00' })
    expect(eventos.map((e) => e.eventoCodigo)).toEqual(['100', '200', '560'])
    const e560 = eventos.find((e) => e.eventoCodigo === '560')!
    expect(e560.itens.find((i) => i.tipo === 'DEBITO')!.contaId).toBe(`id:${CONTAS_EVENTO.caixaArrecadacao}`)
    expect(e560.itens.find((i) => i.tipo === 'CREDITO')!.contaId).toBe(`id:${ATIVO}`) // baixa do crédito a receber
  })

  it('resolverLancamentoTributario gera E550: D ativo / C VPA', async () => {
    const ATIVO = '1.1.2.1.1.01.05.00.00.00.00.00'
    const VPA = '4.1.1.2.50.00.00.00.00.00.00.00'
    comFolhas(mock, [ATIVO, VPA])
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.1.1.2.50', tipoMutacao: 'EFETIVA', indicadorReconhecimento: 'COMPETENCIA', contaContrapartidaCodigo: VPA, contaAtivoCodigo: ATIVO },
    ])
    const eventos = await motor(mock).resolverLancamentoTributario({ entidadeId: ENT, ano: ANO, naturezaCodigo: '1.1.1.2.50.0.1.00.00.00.00.00', valor: '500' })
    expect(eventos).toHaveLength(1)
    expect(eventos[0].eventoCodigo).toBe('550')
    expect(eventos[0].itens.find((i) => i.tipo === 'DEBITO')!.contaId).toBe(`id:${ATIVO}`)
    expect(eventos[0].itens.find((i) => i.tipo === 'CREDITO')!.contaId).toBe(`id:${VPA}`)
  })

  it('lançamento tributário no estorno inverte (C ativo / D VPA)', async () => {
    const ATIVO = '1.1.2.1.1.01.05.00.00.00.00.00'
    const VPA = '4.1.1.2.50.00.00.00.00.00.00.00'
    comFolhas(mock, [ATIVO, VPA])
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.1.1.2.50', tipoMutacao: 'EFETIVA', indicadorReconhecimento: 'COMPETENCIA', contaContrapartidaCodigo: VPA, contaAtivoCodigo: ATIVO },
    ])
    const [e550] = await motor(mock).resolverLancamentoTributario({ entidadeId: ENT, ano: ANO, naturezaCodigo: '1.1.1.2.50.0.1.00.00.00.00.00', valor: '500' }, { estorno: true })
    expect(e550.itens.find((i) => i.contaId === `id:${ATIVO}`)!.tipo).toBe('CREDITO')
  })

  it('resolverInscricaoDividaAtiva gera E570: D dívida ativa / C baixa do circulante', async () => {
    const CIRC = '1.1.2.1.1.01.05.00.00.00.00.00'
    const DA = '1.2.1.1.1.04.01.01.05.00.00.00'
    comFolhas(mock, [CIRC, DA])
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.1.1.2.50.0.1', tipoMutacao: 'EFETIVA', indicadorReconhecimento: 'COMPETENCIA', contaContrapartidaCodigo: 'x', contaAtivoCodigo: CIRC, contaDividaAtivaCodigo: DA },
    ])
    const eventos = await motor(mock).resolverInscricaoDividaAtiva({ entidadeId: ENT, ano: ANO, naturezaCodigo: '1.1.1.2.50.0.1.00.00.00.00.00', valor: '300' })
    expect(eventos[0].eventoCodigo).toBe('570')
    expect(eventos[0].itens.find((i) => i.tipo === 'DEBITO')!.contaId).toBe(`id:${DA}`)
    expect(eventos[0].itens.find((i) => i.tipo === 'CREDITO')!.contaId).toBe(`id:${CIRC}`)
  })

  it('inscrição em dívida ativa falha sem conta de DA configurada', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.1.1.2.50.0.1', tipoMutacao: 'EFETIVA', indicadorReconhecimento: 'COMPETENCIA', contaContrapartidaCodigo: 'x', contaAtivoCodigo: 'a', contaDividaAtivaCodigo: null },
    ])
    await expect(
      motor(mock).resolverInscricaoDividaAtiva({ entidadeId: ENT, ano: ANO, naturezaCodigo: '1.1.1.2.50.0.1.00.00.00.00.00', valor: '1' }),
    ).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
  })

  it('lançamento tributário falha se a natureza não for competência configurada', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([])
    await expect(
      motor(mock).resolverLancamentoTributario({ entidadeId: ENT, ano: ANO, naturezaCodigo: '1.1.1.2.50.0.1.00.00.00.00.00', valor: '1' }),
    ).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
  })

  it('falha clara quando uma folha fixa não existe no plano da entidade', async () => {
    // remove a Receita a Realizar das folhas disponíveis
    comFolhas(
      mock,
      TODAS_FOLHAS.filter((c) => c !== CONTAS_EVENTO.receitaARealizar),
    )
    mock.parametroReceita.findMany.mockResolvedValue([])
    await expect(motor(mock).resolver(baseCtx)).rejects.toThrow(/Integração contábil indisponível/)
  })
})

describe('MotorEventosReceita — controle de baixa (saldo a receber)', () => {
  let mock: PrismaMock
  beforeEach(() => {
    mock = criarPrismaMock()
    mock.entidade.findUnique.mockResolvedValue({ id: ENT, municipio: { modeloContabilId: null, estado: { modeloContabilId: MODELO } } })
  })

  it('saldoDaConta devolve débito − crédito da conta', async () => {
    mock.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1' })
    mock.lancamentoItem.groupBy.mockResolvedValue([
      { tipo: 'DEBITO', _sum: { valor: new Prisma.Decimal('1000') } },
      { tipo: 'CREDITO', _sum: { valor: new Prisma.Decimal('300') } },
    ])
    expect((await motor(mock).saldoDaConta(ENT, ANO, '1.1.2.x')).toString()).toBe('700')
  })

  it('validarBaixaArrecadacao barra arrecadação acima do crédito lançado (e passa dentro do saldo)', async () => {
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.1.1.2.50.0.1', tipoMutacao: 'EFETIVA', indicadorReconhecimento: 'COMPETENCIA', contaContrapartidaCodigo: 'x', contaAtivoCodigo: '1.1.2.x' },
    ])
    mock.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1' })
    mock.lancamentoItem.groupBy.mockResolvedValue([{ tipo: 'DEBITO', _sum: { valor: new Prisma.Decimal('100') } }])
    await expect(motor(mock).validarBaixaArrecadacao(ENT, ANO, '1.1.1.2.50.0.1.00', '150')).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    await expect(motor(mock).validarBaixaArrecadacao(ENT, ANO, '1.1.1.2.50.0.1.00', '80')).resolves.toBeUndefined()
  })

  it('não controla natureza de caixa (não tributária)', async () => {
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', indicadorReconhecimento: 'CAIXA', contaContrapartidaCodigo: 'x', contaAtivoCodigo: null },
    ])
    await expect(motor(mock).validarBaixaArrecadacao(ENT, ANO, '1.3.2.1.01', '9999')).resolves.toBeUndefined()
  })
})
