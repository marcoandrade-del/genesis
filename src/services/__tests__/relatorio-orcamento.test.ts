import { describe, it, expect } from 'vitest'
import { montarReceitaPrevista, documentoPdf, formatarReais } from '../relatorio-orcamento.js'
import type { LinhaArrecadacao } from '../arrecadacoes.js'

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

describe('documentoPdf', () => {
  it('embrulha o corpo num HTML completo', () => {
    const doc = documentoPdf('Título', '<div>corpo</div>')
    expect(doc).toContain('<!DOCTYPE html>')
    expect(doc).toContain('<title>Título</title>')
    expect(doc).toContain('<div>corpo</div>')
  })
})
