import { describe, it, expect } from 'vitest'
import { montarReceitaPrevista, montarDespesaFixada, documentoPdf, formatarReais } from '../relatorio-orcamento.js'
import type { LinhaArrecadacao } from '../arrecadacoes.js'
import type { LinhaSaldo } from '../saldo-orcamentario.js'

const linha = (over: Partial<LinhaArrecadacao>): LinhaArrecadacao => ({
  id: 'x',
  codigo: '1',
  rotulo: 'Receita',
  nivel: 1,
  previsto: 0,
  arrecadado: 0,
  saldo: 0,
  ...over,
})

describe('formatarReais', () => {
  it('formata no padrão pt-BR', () => {
    expect(formatarReais(1234567.8)).toBe('1.234.567,80')
    expect(formatarReais(0)).toBe('0,00')
  })
})

describe('montarReceitaPrevista', () => {
  const base = {
    cabecalho: { entidadeNome: 'Prefeitura de Maringá', municipio: 'Maringá', estado: 'PR', ano: 2026, brasao: 'data:image/png;base64,AAA' },
    porConta: [
      linha({ codigo: '1', rotulo: 'RECEITAS CORRENTES', nivel: 1, previsto: 800 }),
      linha({ codigo: '11', rotulo: 'Impostos', nivel: 2, previsto: 200 }),
    ],
    porFonte: [linha({ codigo: '000', rotulo: 'Recursos Ordinários', nivel: 1, previsto: 1000 })],
    total: 1000,
  }

  it('renderiza cabeçalho, título, árvore, por fonte e total', () => {
    const html = montarReceitaPrevista(base)
    expect(html).toContain('Prefeitura de Maringá')
    expect(html).toContain('Maringá · PR — Exercício 2026')
    expect(html).toContain('Demonstrativo da Receita Orçada — LOA 2026')
    expect(html).toContain('RECEITAS CORRENTES')
    expect(html).toContain('800,00')
    expect(html).toContain('Receita prevista por fonte de recurso')
    expect(html).toContain('Recursos Ordinários')
    expect(html).toContain('1.000,00')
    expect(html).toContain('<img src="data:image/png;base64,AAA"') // brasão presente
    expect(html).toContain('80,0%') // 800/1000
  })

  it('sem brasão não emite img; total zero não quebra o %', () => {
    const html = montarReceitaPrevista({
      ...base,
      cabecalho: { ...base.cabecalho, brasao: null },
      total: 0,
      porConta: [linha({ codigo: '1', rotulo: 'X', nivel: 1, previsto: 0 })],
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('0,0%')
  })

  it('tolera campo nulo sem quebrar (defensivo)', () => {
    const html = montarReceitaPrevista({
      ...base,
      porConta: [linha({ codigo: null as never, rotulo: 'Sem código', nivel: 1, previsto: 10 })],
    })
    expect(html).toContain('Sem código')
  })

  it('escapa caracteres especiais nos nomes', () => {
    const html = montarReceitaPrevista({
      ...base,
      porConta: [linha({ codigo: '1', rotulo: 'A & B <x>', nivel: 1, previsto: 10 })],
    })
    expect(html).toContain('A &amp; B &lt;x&gt;')
    expect(html).not.toContain('A & B <x>')
  })
})

const ls = (over: Partial<LinhaSaldo>): LinhaSaldo => ({
  id: 'x',
  codigo: '1',
  rotulo: 'X',
  nivel: 1,
  autorizado: 0,
  reservado: 0,
  empenhado: 0,
  disponivel: 0,
  ...over,
})

describe('montarDespesaFixada', () => {
  const base = {
    cabecalho: { entidadeNome: 'Prefeitura', municipio: 'Maringá', estado: 'PR', ano: 2026, brasao: null },
    porUnidade: [ls({ codigo: '02', rotulo: 'GABINETE', nivel: 1, autorizado: 600 })],
    porFuncao: [ls({ codigo: '04', rotulo: 'Administração', nivel: 1, autorizado: 1000 })],
    porConta: [
      ls({ codigo: '3', rotulo: 'DESPESAS CORRENTES', nivel: 1, autorizado: 700 }),
      ls({ codigo: '3.1', rotulo: 'Pessoal', nivel: 2, autorizado: 400 }),
    ],
    porFonte: [ls({ codigo: '000', rotulo: 'Ordinários', nivel: 1, autorizado: 1000 })],
    total: 1000,
  }

  it('renderiza os 4 cortes com título e total', () => {
    const html = montarDespesaFixada(base)
    expect(html).toContain('Demonstrativo da Despesa Fixada — LOA 2026')
    expect(html).toContain('Despesa fixada por unidade orçamentária')
    expect(html).toContain('Despesa fixada por função de governo')
    expect(html).toContain('Despesa fixada por natureza')
    expect(html).toContain('Despesa fixada por fonte de recurso')
    expect(html).toContain('GABINETE')
    expect(html).toContain('DESPESAS CORRENTES')
    expect(html).toContain('TOTAL DA DESPESA FIXADA')
    expect(html).toContain('70,0%') // 700/1000 na natureza
  })

  it('com brasão emite a imagem', () => {
    const html = montarDespesaFixada({ ...base, cabecalho: { ...base.cabecalho, brasao: 'data:image/png;base64,ZZ' } })
    expect(html).toContain('<img src="data:image/png;base64,ZZ"')
  })
})

describe('documentoPdf', () => {
  it('embrulha o corpo num HTML completo', () => {
    const doc = documentoPdf('Título', '<div>corpo</div>')
    expect(doc).toContain('<!DOCTYPE html>')
    expect(doc).toContain('<title>Título</title>')
    expect(doc).toContain('<div>corpo</div>')
  })
})
