import { describe, it, expect } from 'vitest'
import { validarEstruturaMsc, ValidadorMscService } from '../validador-msc.js'
import type { LinhaMsc, NaturezaSaldoMsc } from '../matriz-saldos-contabeis.js'

const linha = (
  conta: string,
  naturezaSaldo: NaturezaSaldoMsc | null,
  saldoFinal: number,
  cc: Partial<LinhaMsc['contaCorrente']> = {},
  superavitFinanceiro: string | null = null,
): LinhaMsc => ({
  conta,
  naturezaSaldo,
  superavitFinanceiro,
  contaCorrente: { fonte: null, naturezaReceita: null, dotacaoId: null, funcao: null, subfuncao: null, naturezaDespesa: null, ...cc },
  saldoInicial: 0,
  movimentoDevedor: 0,
  movimentoCredor: 0,
  saldoFinal,
})

// MSC coerente com todas as classes, cada uma do lado da sua natureza (saldo
// devedor com sinal: devedora > 0, credora < 0), sem fonte de dígito 9.
const mscCoerente = (): LinhaMsc[] => [
  linha('1.1.1.1.01.00', 'DEVEDORA', 500), // Ativo
  linha('2.1.1.1.01.00', 'CREDORA', -300), // Passivo circulante
  linha('2.3.1.1.01.00', 'CREDORA', -200), // Patrimônio Líquido
  linha('3.1.1.1.01.00', 'DEVEDORA', 80), // VPD
  linha('4.1.1.1.01.00', 'CREDORA', -80), // VPA
  linha('5.2.1.1.01.00', 'DEVEDORA', 1000), // previsão orçamentária
  linha('6.2.1.2.01.00', 'CREDORA', -1000, { naturezaReceita: '1.7.1.8.03.1.1', fonte: '1500' }), // receita realizada (6.2.1, com natureza+fonte)
  linha('7.1.1.1.01.00', 'DEVEDORA', 10), // controle devedor
  linha('8.1.1.1.01.00', 'CREDORA', -10), // controle credor
]

type Vs = ReturnType<typeof validarEstruturaMsc>
const acha = (vs: Vs, codigo: string) => vs.find((v) => v.codigo === codigo)!

describe('validarEstruturaMsc (Dim I do ICF)', () => {
  it('MSC coerente: 14 checks ativos OK e 4 stubs NAO_APLICAVEL', () => {
    const vs = validarEstruturaMsc(mscCoerente())
    const ativas = vs.filter((v) => v.status !== 'NAO_APLICAVEL')
    expect(ativas).toHaveLength(14)
    expect(ativas.every((v) => v.status === 'OK')).toBe(true)
    expect(vs.filter((v) => v.status === 'NAO_APLICAVEL')).toHaveLength(4)
    expect(vs).toHaveLength(18)
  })

  it('ativo com saldo credor é sinalizado como invertido', () => {
    const v = acha(validarEstruturaMsc([linha('1.1.1.1.01.00', 'DEVEDORA', -500)]), 'MSC_DIM1_ATIVO_INVERTIDO')
    expect(v.status).toBe('DIVERGENTE')
    expect(v.obtido).toBe(1)
  })

  it('passivo e PL são checados separadamente (D1_00025 × D1_00026)', () => {
    // PL (2.3) invertido, passivo (2.1) ok → só o check de PL acusa.
    const linhas = [linha('2.1.1.1.01.00', 'CREDORA', -300), linha('2.3.1.1.01.00', 'CREDORA', 200)]
    const vs = validarEstruturaMsc(linhas)
    expect(acha(vs, 'MSC_DIM1_PL_INVERTIDO').status).toBe('DIVERGENTE')
    expect(acha(vs, 'MSC_DIM1_PASSIVO_INVERTIDO').status).toBe('OK')
  })

  it('retificadora (natureza credora dentro do Ativo, saldo credor) NÃO é falso positivo', () => {
    const linhas = [linha('1.1.1.1.01.00', 'DEVEDORA', 500), linha('1.2.3.8.01.00', 'CREDORA', -40)]
    expect(acha(validarEstruturaMsc(linhas), 'MSC_DIM1_ATIVO_INVERTIDO').status).toBe('OK')
  })

  it('conta MISTA ou sem natureza não é avaliada quanto a inversão', () => {
    const linhas = [linha('1.1.1.1.01.00', 'MISTA', -999), linha('1.1.1.1.02.00', null, -999)]
    expect(acha(validarEstruturaMsc(linhas), 'MSC_DIM1_ATIVO_INVERTIDO').status).toBe('OK')
  })

  it('classe ausente reprova classes-completas', () => {
    const linhas = [linha('1.1.1.1.01.00', 'DEVEDORA', 10), linha('5.2.1.1.01.00', 'DEVEDORA', 10)]
    const v = acha(validarEstruturaMsc(linhas), 'MSC_DIM1_CLASSES_COMPLETAS')
    expect(v.status).toBe('DIVERGENTE')
    expect(v.detalhe).toContain('controle')
  })

  it('fonte de dígito 9 (recursos condicionados) é sinalizada', () => {
    const linhas = [linha('6.2.1.1.01.00', 'CREDORA', -100, { fonte: '9500' })]
    const v = acha(validarEstruturaMsc(linhas), 'MSC_DIM1_FONTE_DIGITO9')
    expect(v.status).toBe('DIVERGENTE')
    expect(v.obtido).toBe(1)
  })

  it('encerramento: VPA/VPD com saldo final reprova; fora do encerramento fica NAO_APLICAVEL', () => {
    const linhas = [linha('4.1.1.1.01.00', 'CREDORA', -80)]
    expect(acha(validarEstruturaMsc(linhas, { encerramento: true }), 'MSC_DIM1_VPA_VPD_ENCERRAMENTO').status).toBe('DIVERGENTE')
    expect(acha(validarEstruturaMsc(linhas), 'MSC_DIM1_VPA_VPD_ENCERRAMENTO').status).toBe('NAO_APLICAVEL')
  })

  it('atributo F (financeiro) sem fonte é sinalizado; com fonte passa', () => {
    const semFonte = linha('1.1.1.1.01.00', 'DEVEDORA', 100, {}, 'FINANCEIRO')
    const comFonte = linha('1.1.1.2.01.00', 'DEVEDORA', 100, { fonte: '1500' }, 'FINANCEIRO')
    const v = acha(validarEstruturaMsc([semFonte, comFonte]), 'MSC_DIM1_ATRIBUTO_F_SEM_FONTE')
    expect(v.status).toBe('DIVERGENTE')
    expect(v.obtido).toBe(1)
  })

  it('despesa (marcada por dotacaoId) sem função/natureza/fonte é sinalizada; patrimonial não entra', () => {
    const completa = linha('6.2.2.1.01.00', 'DEVEDORA', 50, { dotacaoId: 'd1', funcao: '10', subfuncao: '301', naturezaDespesa: '3.3.90.30', fonte: '1500' })
    const semTudo = linha('6.2.2.1.02.00', 'DEVEDORA', 50, { dotacaoId: 'd2' })
    const patrimonial = linha('1.1.1.1.01.00', 'DEVEDORA', 50) // sem dotacaoId → não é despesa
    const vs = validarEstruturaMsc([completa, semTudo, patrimonial])
    expect(acha(vs, 'MSC_DIM1_DESPESA_SEM_FUNCAO').obtido).toBe(1)
    expect(acha(vs, 'MSC_DIM1_DESPESA_SEM_NATUREZA').obtido).toBe(1)
    expect(acha(vs, 'MSC_DIM1_DESPESA_SEM_FONTE').obtido).toBe(1)
    expect(acha(vs, 'MSC_DIM1_DESPESA_SEM_FUNCAO').status).toBe('DIVERGENTE')
  })

  it('receita orçamentária (6.2.1) sem natureza/fonte é sinalizada; fora de 6.2.1 não entra', () => {
    const semNat = linha('6.2.1.2.01.00', 'CREDORA', -100, { fonte: '1500' }) // natureza null
    const semFonte = linha('6.2.1.1.01.00', 'MISTA', 100, { naturezaReceita: '1.7.1' }) // fonte null
    const patrimonial = linha('1.1.1.1.01.00', 'DEVEDORA', 100) // não é 6.2.1
    const vs = validarEstruturaMsc([semNat, semFonte, patrimonial])
    expect(acha(vs, 'MSC_DIM1_RECEITA_SEM_NATUREZA').obtido).toBe(1)
    expect(acha(vs, 'MSC_DIM1_RECEITA_SEM_FONTE').obtido).toBe(1)
  })

  it('todo stub carrega o id da verificação do catálogo STN no detalhe', () => {
    const stubs = validarEstruturaMsc(mscCoerente()).filter((v) => v.status === 'NAO_APLICAVEL')
    expect(stubs.every((v) => /D1_\d{5}/.test(v.detalhe))).toBe(true)
  })
})

describe('ValidadorMscService', () => {
  const matrizFake = (linhas: LinhaMsc[]) => ({
    entidade: { id: 'e1', nome: 'Prefeitura', municipio: 'Maringá', estado: 'PR' },
    ano: 2026,
    mes: 6,
    tipo: 'AGREGADA' as const,
    metodologia: '',
    linhas,
    verificacoes: [],
    selo: { aprovadas: 0, avaliadas: 0, total: 0 },
  })

  it('monta o selo a partir das verificações da MSC emitida', async () => {
    const msc = { emitir: async () => matrizFake(mscCoerente()) } as any
    const r = await new ValidadorMscService({} as any, msc).validar('e1', 2026, 6)
    expect(r).not.toBeNull()
    expect(r!.selo).toEqual({ aprovadas: 14, avaliadas: 14, total: 18 })
    expect(r!.entidade.nome).toBe('Prefeitura')
  })

  it('devolve null quando a entidade não existe', async () => {
    const msc = { emitir: async () => null } as any
    expect(await new ValidadorMscService({} as any, msc).validar('nope', 2026, 6)).toBeNull()
  })
})
