import { describe, it, expect } from 'vitest'
import { montarReceitaPrevista, montarDespesaFixada, montarProgramaTrabalho, montarSumarioGeral, montarRcl, montarRclConsolidada, montarGuardiao, montarDespesaPessoal, documentoPdf, formatarReais, formatarCodigoConta, formatarEmissao } from '../relatorio-orcamento.js'
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

describe('formatarCodigoConta', () => {
  const cod = '1.0.0.0.00.0.0.00.00.00.00.00'
  it('completo devolve o código como está', () => {
    expect(formatarCodigoConta(cod, { modo: 'completo', nivelMax: 4 })).toBe(cod)
  })
  it('curto remove os zeros à direita', () => {
    expect(formatarCodigoConta(cod, { modo: 'curto', nivelMax: 4 })).toBe('1')
    expect(formatarCodigoConta('1.1.2.0.00', { modo: 'curto', nivelMax: 4 })).toBe('1.1.2')
  })
  it('curto preserva zeros internos (só corta os do fim)', () => {
    expect(formatarCodigoConta('1.0.5.0.0', { modo: 'curto', nivelMax: 4 })).toBe('1.0.5')
  })
  it('nivel corta nos N primeiros segmentos', () => {
    expect(formatarCodigoConta(cod, { modo: 'nivel', nivelMax: 3 })).toBe('1.0.0')
    expect(formatarCodigoConta(cod, { modo: 'nivel', nivelMax: 0 })).toBe('1') // mínimo 1
  })
  it('código todo-zero mantém ao menos o 1º segmento', () => {
    expect(formatarCodigoConta('0.0.0', { modo: 'curto', nivelMax: 4 })).toBe('0')
  })
})

describe('montarReceitaPrevista aplica o formato de código', () => {
  const base = (codigoConta: { modo: 'completo' | 'curto' | 'nivel'; nivelMax: number }) => ({
    cabecalho: { entidadeNome: 'P', municipio: 'M', estado: 'PR', ano: 2026, brasao: null },
    porConta: [linha({ codigo: '1.0.0.0.00', rotulo: 'Correntes', nivel: 1, previsto: 10 })],
    porFonte: [],
    total: 10,
    codigoConta,
  })
  it('curto trima na tabela de natureza', () => {
    const html = montarReceitaPrevista(base({ modo: 'curto', nivelMax: 4 }))
    expect(html).toContain('>1<') // código trimado
    expect(html).not.toContain('1.0.0.0.00')
  })
  it('completo mantém o código cheio', () => {
    const html = montarReceitaPrevista(base({ modo: 'completo', nivelMax: 4 }))
    expect(html).toContain('1.0.0.0.00')
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
    expect(html).toContain('Anexo 2, da Lei nº 4.320/64 — Resumo Geral da Receita')
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

  it('tolera campos nulos sem quebrar (defensivo)', () => {
    const html = montarReceitaPrevista({
      ...base,
      porConta: [linha({ codigo: null as never, rotulo: null as never, nivel: 1, previsto: 10 })],
    })
    expect(html).toContain('10,00')
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
    expect(html).toContain('Demonstrativos da Despesa Fixada')
    expect(html).toContain('Demonstração da Despesa por Unidades Orçamentárias')
    expect(html).toContain('Demonstrativo da Despesa por Funções')
    expect(html).toContain('Natureza da Despesa Segundo as Categorias Econômicas')
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

describe('montarProgramaTrabalho', () => {
  it('renderiza a árvore funcional-programática com total', () => {
    const html = montarProgramaTrabalho({
      cabecalho: { entidadeNome: 'Prefeitura', municipio: 'Maringá', estado: 'PR', ano: 2026, brasao: null },
      linhas: [
        { codigo: '02', rotulo: 'Gabinete', nivel: 1, valor: 600 },
        { codigo: '04', rotulo: 'Administração', nivel: 2, valor: 600 },
        { codigo: '2001', rotulo: 'Gestão', nivel: 5, valor: 600 },
      ],
      total: 600,
    })
    expect(html).toContain('Anexo 6, da Lei nº 4.320/64 — Programa de Trabalho')
    expect(html).toContain('Gabinete')
    expect(html).toContain('TOTAL DA DESPESA FIXADA')
    expect(html).toContain('100,0%')
  })

  it('com brasão emite a imagem', () => {
    const html = montarProgramaTrabalho({
      cabecalho: { entidadeNome: 'P', municipio: 'M', estado: 'PR', ano: 2026, brasao: 'data:image/png;base64,QQ' },
      linhas: [{ codigo: '02', rotulo: 'Gab', nivel: 1, valor: 10 }],
      total: 10,
    })
    expect(html).toContain('<img src="data:image/png;base64,QQ"')
  })
})

describe('formatarEmissao', () => {
  const d = new Date(2026, 5, 26, 9, 5) // 26/06/2026 09:05 (mês 0-based)
  it('data + hora', () => expect(formatarEmissao(d, true, true)).toBe('26/06/2026 às 09:05'))
  it('só data', () => expect(formatarEmissao(d, true, false)).toBe('26/06/2026'))
  it('só hora', () => expect(formatarEmissao(d, false, true)).toBe('09:05'))
  it('nenhum → vazio', () => expect(formatarEmissao(d, false, false)).toBe(''))
})

describe('montarSumarioGeral', () => {
  it('renderiza receita por fonte, despesa por função e o saldo', () => {
    const html = montarSumarioGeral({
      cabecalho: { entidadeNome: 'P', municipio: 'M', estado: 'PR', ano: 2026, brasao: null },
      receitaPorFonte: [linha({ codigo: '000', rotulo: 'Ordinários', nivel: 1, previsto: 1000 })],
      despesaPorFuncao: [ls({ codigo: '04', rotulo: 'Administração', nivel: 1, autorizado: 900 })],
      totalReceita: 1000,
      totalDespesa: 900,
    })
    expect(html).toContain('Sumário Geral da Receita por Fontes e da Despesa por Funções do Governo')
    expect(html).toContain('Ordinários')
    expect(html).toContain('Administração')
    expect(html).toContain('SUPERÁVIT / (DÉFICIT)')
    expect(html).toContain('100,00') // 1000 − 900
  })
})

describe('montarRcl', () => {
  const cab = { entidadeNome: 'P', municipio: 'M', estado: 'PR', ano: 2026, brasao: null }
  it('renderiza correntes, deduções e a RCL', () => {
    const html = montarRcl({
      cabecalho: cab,
      correntes: [{ codigo: '1.1', rotulo: 'Impostos', valor: 1000 }],
      correntesTotal: 1000,
      deducoes: [{ codigo: '1.2.1.8', rotulo: 'RPPS', valor: 200 }],
      deducoesTotal: 200,
      rcl: 800,
    })
    expect(html).toContain('RREO Anexo 3 — Demonstrativo da Receita Corrente Líquida')
    expect(html).toContain('Impostos')
    expect(html).toContain('RECEITA CORRENTE LÍQUIDA')
    expect(html).not.toContain('provisória')
  })
  it('avisa RCL provisória quando as deduções somam zero', () => {
    const html = montarRcl({
      cabecalho: cab,
      correntes: [{ codigo: '1.1', rotulo: 'Impostos', valor: 500 }],
      correntesTotal: 500,
      deducoes: [{ codigo: '', rotulo: 'Formação do FUNDEB', valor: 0 }],
      deducoesTotal: 0,
      rcl: 500,
    })
    expect(html).toContain('provisória')
    expect(html).toContain('Deduções zeradas')
    expect(html).toContain('Formação do FUNDEB') // linha de dedução nomeada aparece mesmo zerada
  })
})

describe('montarRclConsolidada', () => {
  it('renderiza a contribuição por entidade e o total do município', () => {
    const html = montarRclConsolidada({
      cabecalho: { entidadeNome: 'P', municipio: 'M', estado: 'PR', ano: 2026, brasao: null },
      entidades: [
        { nome: 'Prefeitura', correntes: 1000, deducoes: 200, rcl: 800 },
        { nome: 'Câmara', correntes: 0, deducoes: 0, rcl: 0 },
      ],
      correntesTotal: 1000,
      deducoesTotal: 200,
      intra: 0,
      rclTotal: 800,
      metodologia: 'TCE-PR',
    })
    expect(html).toContain('Consolidado')
    expect(html).toContain('Prefeitura')
    expect(html).toContain('Câmara')
    expect(html).toContain('TOTAL DO MUNICÍPIO')
    expect(html).toContain('RECEITA CORRENTE LÍQUIDA CONSOLIDADA')
    expect(html).toContain('duplicidades')
  })
})

describe('montarGuardiao', () => {
  it('renderiza indicadores com situação, limite e memórias', () => {
    const html = montarGuardiao({
      cabecalho: { entidadeNome: 'P', municipio: 'M', estado: 'PR', ano: 2026, brasao: null },
      metodologia: 'TCE-PR',
      indicadores: [
        { indicador: 'Despesa com Pessoal', unidade: '% da RCL', valor: 1148, base: 2604, percentual: 44.1, limite: 54, nivel: 'ok', memorial: { descricao: 'pessoal ÷ rcl', baseLegal: 'LRF 19-20' } },
        { indicador: 'Aplicação em Educação', unidade: '% da despesa', valor: 657, base: 2848, percentual: 23.1, limite: null, nivel: 'ok', memorial: { descricao: 'função 12', baseLegal: 'CF 212' } },
      ],
    })
    expect(html).toContain('Guardião LRF')
    expect(html).toContain('Despesa com Pessoal')
    expect(html).toContain('Dentro do limite') // nível ok com limite
    expect(html).toContain('informativo') // educação sem limite
    expect(html).toContain('44,1%')
    expect(html).toContain('Memórias de cálculo')
  })
})

describe('montarDespesaPessoal', () => {
  it('renderiza inclusões, exclusões, a DTP e o % da RCL com situação', () => {
    const html = montarDespesaPessoal({
      cabecalho: { entidadeNome: 'P', municipio: 'M', estado: 'PR', ano: 2026, brasao: null },
      inclusoes: [{ rotulo: 'Pessoal e Encargos (3.1)', valor: 1148 }, { rotulo: 'Terceirização', valor: 18 }],
      inclusoesTotal: 1166,
      exclusoes: [{ rotulo: '(−) Indenizações', valor: 14 }],
      exclusoesTotal: 14,
      despesaLiquida: 1152,
      rcl: 2604,
      percentual: 44.23,
      limite: 54,
      prudencial: 51.3,
      alerta: 48.6,
      nivel: 'ok',
      nota: 'LRF/STN',
    })
    expect(html).toContain('RGF Anexo 1 — Demonstrativo da Despesa com Pessoal')
    expect(html).toContain('Pessoal e Encargos (3.1)')
    expect(html).toContain('DESPESA TOTAL COM PESSOAL')
    expect(html).toContain('44,23%')
    expect(html).toContain('Dentro do limite')
    expect(html).toContain('Limite legal: 54,00%')
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
