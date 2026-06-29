import { describe, it, expect } from 'vitest'
import {
  classificarFonte,
  classificacaoDoEstado,
  parseClassificacaoFonte,
  resolverClassificacaoFonte,
  CLASSIFICACAO_STN,
  type ClassificacaoFonte,
} from '../fonte-classificacao.js'

describe('classificarFonte', () => {
  const pr = classificacaoDoEstado('PR')

  it('classifica os códigos reais de Maringá pela 1ª regra que casa', () => {
    expect(classificarFonte('1000', pr)).toBe('LIVRES')
    expect(classificarFonte('11045', pr)).toBe('LIVRES')
    expect(classificarFonte('1101', pr)).toBe('FUNDEB')
    expect(classificarFonte('1102', pr)).toBe('FUNDEB')
    expect(classificarFonte('1104', pr)).toBe('MDE')
    expect(classificarFonte('1107', pr)).toBe('MDE')
    expect(classificarFonte('1303', pr)).toBe('ASPS')
    expect(classificarFonte('1486', pr)).toBe('ASPS')
    expect(classificarFonte('41197', pr)).toBe('DIVIDA')
  })

  it('fonte não discriminada (9999) e cauda não mapeada → NAO_CLASSIFICADA (honesto)', () => {
    expect(classificarFonte('9999', pr)).toBe('NAO_CLASSIFICADA')
    expect(classificarFonte('1509', pr)).toBe('NAO_CLASSIFICADA') // trânsito — não classificada ainda
  })

  it('STN (sem regras) → tudo NAO_CLASSIFICADA', () => {
    expect(classificarFonte('1104', CLASSIFICACAO_STN)).toBe('NAO_CLASSIFICADA')
  })

  it('a ordem das regras decide o empate de prefixo (primeira vence)', () => {
    const comp: ClassificacaoFonte = {
      nome: 't',
      regras: [
        { finalidade: 'MDE', prefixos: ['1'] },
        { finalidade: 'ASPS', prefixos: ['11'] },
      ],
    }
    expect(classificarFonte('1101', comp)).toBe('MDE') // 1ª regra ('1') casa antes
  })
})

describe('classificacaoDoEstado', () => {
  it('PR retorna o delta do TCE-PR', () => {
    expect(classificacaoDoEstado('PR').nome).toContain('TCE-PR')
  })
  it('Estado sem delta (ou nulo) cai na STN', () => {
    expect(classificacaoDoEstado('SP')).toBe(CLASSIFICACAO_STN)
    expect(classificacaoDoEstado(null)).toBe(CLASSIFICACAO_STN)
  })
})

describe('parseClassificacaoFonte', () => {
  it('aceita JSON válido (nome + regras)', () => {
    const c = parseClassificacaoFonte({ nome: 'X', regras: [{ finalidade: 'MDE', prefixos: ['1104'] }] })
    expect(c).toEqual({ nome: 'X', regras: [{ finalidade: 'MDE', prefixos: ['1104'] }] })
  })
  it('descarta finalidade inválida, regra sem prefixos e prefixo não-string; nome genérico quando ausente', () => {
    const c = parseClassificacaoFonte({
      regras: [
        { finalidade: 'INVENTADA', prefixos: ['9'] }, // finalidade fora do enum → descarta
        { finalidade: 'MDE', prefixos: [] }, // sem prefixos → descarta
        { finalidade: 'ASPS', prefixos: ['1303', 7, ' '] }, // filtra não-string/vazio
      ],
    })
    expect(c!.nome).toContain('Personalizada')
    expect(c!.regras).toEqual([{ finalidade: 'ASPS', prefixos: ['1303'] }])
  })
  it('retorna null para inválido/vazio', () => {
    expect(parseClassificacaoFonte(null)).toBeNull()
    expect(parseClassificacaoFonte('x')).toBeNull()
    expect(parseClassificacaoFonte({ regras: 'nope' })).toBeNull()
    expect(parseClassificacaoFonte({ regras: [{ finalidade: 'MDE', prefixos: [] }] })).toBeNull()
  })
})

describe('resolverClassificacaoFonte', () => {
  it('config do banco tem prioridade sobre o default', () => {
    const c = resolverClassificacaoFonte('PR', { nome: 'C', regras: [{ finalidade: 'LIVRES', prefixos: ['9'] }] })
    expect(c.nome).toBe('C')
  })
  it('sem config cai no default do Estado/STN', () => {
    expect(resolverClassificacaoFonte('PR', null).nome).toContain('TCE-PR')
    expect(resolverClassificacaoFonte('SP', null)).toBe(CLASSIFICACAO_STN)
  })
})
