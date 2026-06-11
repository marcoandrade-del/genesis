import { describe, it, expect } from 'vitest'
import {
  celula,
  analisarColunas,
  linhaTotal,
  paginar,
  montarRender,
  linhasPorPagina,
  rotuloPadrao,
  configPadrao,
  configEfetiva,
  validarTotaisConfig,
  lerTotaisConfig,
  valorAgg,
  resumoTotais,
  type TotaisConfig,
} from '../relatorio-totais.js'
import { ErroNegocio } from '../../errors.js'

describe('relatorio-totais', () => {
  describe('celula', () => {
    it('formata null/Date/number/string', () => {
      expect(celula(null)).toBe('')
      expect(celula(undefined)).toBe('')
      expect(celula(new Date(2026, 0, 15))).toBe('15/01/2026')
      expect(celula(1234.5)).toBe('1234.5')
      expect(celula('abc')).toBe('abc')
    })
  })

  describe('analisarColunas', () => {
    it('detecta colunas de valor; ignora texto, código (zero à esquerda) e datas', () => {
      const r = {
        colunas: ['conta', 'descricao', 'valor', 'data'],
        linhas: [
          ['001', 'Empenho', '100.50', new Date(2026, 0, 1)],
          ['002', 'Liquidação', '200.25', new Date(2026, 0, 2)],
        ],
      }
      const t = analisarColunas(r)
      expect(t.numericas).toEqual([false, false, true, false]) // conta='001' é código, não valor
      expect(t.soma[2]).toBe(300.75)
      expect(t.decimais[2]).toBe(2)
      expect(t.algumaNumerica).toBe(true)
    })

    it('arredonda a soma às casas da coluna (sem ruído de float)', () => {
      const t = analisarColunas({ colunas: ['v'], linhas: [['0.1'], ['0.2']] })
      expect(t.soma[0]).toBe(0.3)
      expect(t.decimais[0]).toBe(1)
    })

    it('coluna com qualquer célula não-numérica não é de valor', () => {
      const t = analisarColunas({ colunas: ['v'], linhas: [['10'], ['x']] })
      expect(t.numericas[0]).toBe(false)
    })

    it('inteiros e números nativos contam como valor; célula vazia é ignorada', () => {
      const t = analisarColunas({ colunas: ['qtd'], linhas: [[2], [3], [null], ['']] })
      expect(t.numericas[0]).toBe(true)
      expect(t.soma[0]).toBe(5)
      expect(t.decimais[0]).toBe(0)
    })

    it('sem nenhuma coluna de valor → algumaNumerica false', () => {
      expect(analisarColunas({ colunas: ['a'], linhas: [['x'], ['y']] }).algumaNumerica).toBe(false)
    })

    it('number não-finito (NaN/Infinity) não conta como valor', () => {
      expect(analisarColunas({ colunas: ['v'], linhas: [[NaN], [Infinity]] }).numericas[0]).toBe(false)
    })

    it('rastreia contagem (não-vazias), mínimo e máximo por coluna', () => {
      const t = analisarColunas({
        colunas: ['nome', 'valor'],
        linhas: [['a', '10.00'], ['b', '2.50'], [null, '7.00'], ['d', null]],
      })
      expect(t.contagem).toEqual([3, 3]) // não-vazias, mesmo em coluna de texto
      expect(t.minimo[1]).toBe(2.5)
      expect(t.maximo[1]).toBe(10)
      expect(t.minimo[0]).toBeNull()
    })
  })

  describe('rotuloPadrao', () => {
    it('concatena a escolha com o título da coluna', () => {
      expect(rotuloPadrao('SOMA', 'impostos')).toBe('Total de impostos')
      expect(rotuloPadrao('CONTAGEM', 'imoveis')).toBe('Contagem de imoveis')
      expect(rotuloPadrao('MEDIA', 'valor')).toBe('Média de valor')
      expect(rotuloPadrao('MINIMO', 'valor')).toBe('Menor valor')
      expect(rotuloPadrao('MAXIMO', 'valor')).toBe('Maior valor')
    })
  })

  describe('configPadrao / configEfetiva', () => {
    const r = { colunas: ['conta', 'valor'], linhas: [['001', '10.00'], ['002', '5.50']] }
    it('default: soma em toda coluna numérica + subtotal por página', () => {
      expect(configPadrao(r)).toEqual({ subtotalPagina: true, itens: [{ coluna: 'valor', agg: 'SOMA' }] })
    })
    it('configEfetiva usa a salva quando existe; senão a default', () => {
      const salva: TotaisConfig = { subtotalPagina: false, itens: [] }
      expect(configEfetiva(r, salva)).toBe(salva)
      expect(configEfetiva(r, null)).toEqual(configPadrao(r))
    })
  })

  describe('validarTotaisConfig', () => {
    it('null/vazio → null (volta ao automático)', () => {
      expect(validarTotaisConfig(null)).toBeNull()
      expect(validarTotaisConfig(undefined)).toBeNull()
      expect(validarTotaisConfig('')).toBeNull()
    })
    it('sanitiza itens (trim de coluna, rótulo opcional limitado a 120)', () => {
      const cfg = validarTotaisConfig({
        subtotalPagina: true,
        itens: [
          { coluna: ' valor ', agg: 'SOMA', rotulo: ' Total dos impostos ' },
          { coluna: 'qtd', agg: 'CONTAGEM', rotulo: 'x'.repeat(200) },
          { coluna: 'qtd', agg: 'MEDIA', rotulo: '' },
        ],
      })
      expect(cfg).toEqual({
        subtotalPagina: true,
        itens: [
          { coluna: 'valor', agg: 'SOMA', rotulo: 'Total dos impostos' },
          { coluna: 'qtd', agg: 'CONTAGEM', rotulo: 'x'.repeat(120) },
          { coluna: 'qtd', agg: 'MEDIA' },
        ],
      })
    })
    it('subtotalPagina false (booleano ou string) desliga o subtotal', () => {
      expect(validarTotaisConfig({ subtotalPagina: false, itens: [] })!.subtotalPagina).toBe(false)
      expect(validarTotaisConfig({ subtotalPagina: 'false', itens: [] })!.subtotalPagina).toBe(false)
      expect(validarTotaisConfig({ itens: [] })!.subtotalPagina).toBe(true)
    })
    it('rejeita estrutura malformada', () => {
      expect(() => validarTotaisConfig('lixo')).toThrow(ErroNegocio)
      expect(() => validarTotaisConfig({ itens: 'x' })).toThrow(ErroNegocio)
      expect(() => validarTotaisConfig({ itens: [{ coluna: '', agg: 'SOMA' }] })).toThrow(ErroNegocio)
      expect(() => validarTotaisConfig({ itens: [{ coluna: 'v', agg: 'MODA' }] })).toThrow(ErroNegocio)
      expect(() => validarTotaisConfig({ itens: [null] })).toThrow(ErroNegocio)
    })
  })

  describe('lerTotaisConfig', () => {
    it('lê a config de configuracao.totais', () => {
      const cfg = lerTotaisConfig({ totais: { subtotalPagina: false, itens: [{ coluna: 'v', agg: 'SOMA' }] } })
      expect(cfg).toEqual({ subtotalPagina: false, itens: [{ coluna: 'v', agg: 'SOMA' }] })
    })
    it('sem chave/lixo → null (automático)', () => {
      expect(lerTotaisConfig(null)).toBeNull()
      expect(lerTotaisConfig({})).toBeNull()
      expect(lerTotaisConfig({ totais: 'lixo' })).toBeNull()
      expect(lerTotaisConfig({ totais: { itens: [{ coluna: 'v', agg: 'MODA' }] } })).toBeNull()
    })
  })

  describe('valorAgg / resumoTotais', () => {
    const r = {
      colunas: ['conta', 'valor'],
      linhas: [['001', '10.00'], ['002', '5.50'], ['003', '2.50']],
    }
    const t = analisarColunas(r)

    it('calcula soma/contagem/média/mín/máx formatados nas casas da coluna', () => {
      expect(valorAgg(t, 1, 'SOMA')).toEqual({ texto: '18.00', numero: 18 })
      expect(valorAgg(t, 1, 'CONTAGEM')).toEqual({ texto: '3', numero: 3 })
      expect(valorAgg(t, 1, 'MEDIA')).toEqual({ texto: '6.00', numero: 6 })
      expect(valorAgg(t, 1, 'MINIMO')).toEqual({ texto: '2.50', numero: 2.5 })
      expect(valorAgg(t, 1, 'MAXIMO')).toEqual({ texto: '10.00', numero: 10 })
    })

    it('média de inteiros ganha 2 casas', () => {
      const r2 = { colunas: ['qtd'], linhas: [[1], [2]] }
      expect(valorAgg(analisarColunas(r2), 0, 'MEDIA')).toEqual({ texto: '1.50', numero: 1.5 })
    })

    it('contagem vale para coluna não-numérica; as demais não', () => {
      expect(valorAgg(t, 0, 'CONTAGEM')).toEqual({ texto: '3', numero: 3 })
      expect(valorAgg(t, 0, 'SOMA')).toBeNull()
      expect(valorAgg(t, 0, 'MEDIA')).toBeNull()
      expect(valorAgg(t, 0, 'MINIMO')).toBeNull()
      expect(valorAgg(t, 0, 'MAXIMO')).toBeNull()
    })

    it('resumo: uma linha por agregação, rótulo default ou do usuário', () => {
      const cfg: TotaisConfig = {
        subtotalPagina: true,
        itens: [
          { coluna: 'valor', agg: 'SOMA', rotulo: 'Total dos impostos' },
          { coluna: 'conta', agg: 'CONTAGEM' },
        ],
      }
      expect(resumoTotais(r, cfg, t)).toEqual([
        { rotulo: 'Total dos impostos', texto: '18.00', numero: 18 },
        { rotulo: 'Contagem de conta', texto: '3', numero: 3 },
      ])
    })

    it('resumo ignora coluna que sumiu do resultado e agregação inaplicável', () => {
      const cfg: TotaisConfig = {
        subtotalPagina: true,
        itens: [
          { coluna: 'fantasma', agg: 'SOMA' },
          { coluna: 'conta', agg: 'MEDIA' }, // conta não é numérica
          { coluna: 'valor', agg: 'SOMA' },
        ],
      }
      expect(resumoTotais(r, cfg, t)).toEqual([{ rotulo: 'Total de valor', texto: '18.00', numero: 18 }])
    })

    it('sem linhas → resumo vazio', () => {
      const vazio = { colunas: ['valor'], linhas: [] }
      expect(resumoTotais(vazio, { subtotalPagina: true, itens: [{ coluna: 'valor', agg: 'SOMA' }] })).toEqual([])
    })
  })

  describe('linhaTotal / paginar', () => {
    const r = { colunas: ['c', 'v'], linhas: [['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'], ['e', '5']] }
    const t = analisarColunas(r)
    const somaveis = [false, true]

    it('rótulo na 1ª coluna não-somada; números nas casas da coluna', () => {
      expect(linhaTotal(t, somaveis, r.colunas, t.soma, 'Total da página')).toEqual(['Total da página', '15'])
    })
    it('coluna nem rótulo nem somada fica vazia', () => {
      const r3 = { colunas: ['c', 'v', 'w'], linhas: [['a', '1', '2'], ['b', '3', '4']] }
      const t3 = analisarColunas(r3)
      expect(linhaTotal(t3, [false, true, false], r3.colunas, t3.soma, 'Total')).toEqual(['Total', '4', ''])
    })
    it('todas as colunas somadas → rótulo na coluna 0 (cede a soma dela ao rótulo)', () => {
      const r2 = { colunas: ['a', 'b'], linhas: [['1', '2'], ['3', '4']] }
      const t2 = analisarColunas(r2)
      expect(linhaTotal(t2, [true, true], r2.colunas, t2.soma, 'TOTAL')).toEqual(['TOTAL', '6'])
    })
    it('quebra em páginas e soma cada subtotal', () => {
      const pgs = paginar(r, t, somaveis, 2)
      expect(pgs).toHaveLength(3)
      expect(pgs[0]!.linhas).toHaveLength(2)
      expect(pgs[0]!.subtotal).toEqual(['Total da página', '3'])
      expect(pgs[2]!.subtotal).toEqual(['Total da página', '5'])
    })
    it('célula vazia na coluna somada não quebra o subtotal da página', () => {
      const r4 = { colunas: ['c', 'v'], linhas: [['a', '1'], ['b', null], ['c', '3']] }
      const pgs = paginar(r4, analisarColunas(r4), [false, true], 10)
      expect(pgs[0]!.subtotal).toEqual(['Total da página', '4'])
    })
  })

  describe('montarRender', () => {
    const num = { colunas: ['c', 'v'], linhas: [['a', '1'], ['b', '2'], ['c', '3']] }

    it('sem coluna de valor → só detalhes, resumo vazio', () => {
      const r = montarRender({ colunas: ['c'], linhas: [['x'], ['y']] }, 2)
      expect(r.linhas.every((l) => l.tipo === 'detalhe')).toBe(true)
      expect(r.resumo).toEqual([])
      expect(r.numericas).toEqual([false])
    })

    it('default: uma página → só detalhes; resumo com "Total de <coluna>"', () => {
      const r = montarRender(num, 10)
      expect(r.linhas.filter((l) => l.tipo === 'subtotal')).toHaveLength(0)
      expect(r.resumo).toEqual([{ rotulo: 'Total de v', texto: '6', numero: 6 }])
      expect(r.parcial).toBe(false)
    })

    it('default: múltiplas páginas → subtotal de soma por página', () => {
      const r = montarRender(num, 2)
      expect(r.linhas.filter((l) => l.tipo === 'subtotal')).toHaveLength(2)
      expect(r.linhas.filter((l) => l.tipo === 'subtotal')[0]!.celulas).toEqual(['Total da página', '3'])
    })

    it('config com subtotalPagina=false → sem subtotais mesmo com várias páginas', () => {
      const cfg: TotaisConfig = { subtotalPagina: false, itens: [{ coluna: 'v', agg: 'SOMA' }] }
      const r = montarRender(num, 2, cfg)
      expect(r.linhas.filter((l) => l.tipo === 'subtotal')).toHaveLength(0)
      expect(r.resumo).toHaveLength(1)
    })

    it('config sem nenhuma SOMA → sem subtotais; resumo segue a config', () => {
      const cfg: TotaisConfig = { subtotalPagina: true, itens: [{ coluna: 'v', agg: 'MAXIMO' }] }
      const r = montarRender(num, 2, cfg)
      expect(r.linhas.filter((l) => l.tipo === 'subtotal')).toHaveLength(0)
      expect(r.resumo).toEqual([{ rotulo: 'Maior v', texto: '3', numero: 3 }])
    })

    it('config vazia (nenhum total) → só detalhes e resumo vazio', () => {
      const r = montarRender(num, 2, { subtotalPagina: true, itens: [] })
      expect(r.linhas.every((l) => l.tipo === 'detalhe')).toBe(true)
      expect(r.resumo).toEqual([])
    })

    it('truncado com totais → parcial true', () => {
      const r = montarRender({ ...num, truncado: true }, 10)
      expect(r.parcial).toBe(true)
    })

    it('truncado sem totais → parcial false', () => {
      const r = montarRender({ colunas: ['c'], linhas: [['x']], truncado: true }, 10)
      expect(r.parcial).toBe(false)
    })
  })

  describe('linhasPorPagina', () => {
    it('estima pela geometria e respeita os limites [5,80]', () => {
      expect(linhasPorPagina(12, 12)).toBeGreaterThan(20)
      expect(linhasPorPagina(140, 140)).toBe(5) // margens enormes → piso 5
      expect(linhasPorPagina(0, 0)).toBeLessThanOrEqual(80)
    })
  })
})
