import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MotorEventosReceita, CONTAS_EVENTO } from '../motor-eventos-receita.js'

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
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaVpaCodigo: VPA_APLIC },
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
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'NAO_EFETIVA', contaVpaCodigo: VPA_APLIC },
    ])
    const eventos = await motor(mock).resolver(baseCtx)
    expect(eventos.map((e) => e.eventoCodigo)).toEqual(['100', '200'])
  })

  it('E300: D Caixa (cc fonte) / C VPA do de/para (cc natureza)', async () => {
    comFolhas(mock)
    mock.parametroReceita.findMany.mockResolvedValue([
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaVpaCodigo: VPA_APLIC },
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
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaVpaCodigo: VPA_APLIC },
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
      { naturezaCodigo: '1.3', tipoMutacao: 'NAO_EFETIVA', contaVpaCodigo: 'x' },
      { naturezaCodigo: '1.3.2.1', tipoMutacao: 'EFETIVA', contaVpaCodigo: VPA_APLIC },
    ])
    const eventos = await motor(mock).resolver(baseCtx)
    // o prefixo mais específico (1.3.2.1, EFETIVA) é o que vale → tem E300
    expect(eventos.some((e) => e.eventoCodigo === '300')).toBe(true)
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
