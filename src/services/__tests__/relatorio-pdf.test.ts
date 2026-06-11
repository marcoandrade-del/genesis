import { describe, it, expect } from 'vitest'
import { montarTemplateFaixa, montarCorpoHtml, margemParaFaixa, estiloElemento } from '../relatorio-pdf.js'

const DADOS = {
  nomeEntidade: 'Prefeitura',
  enderecoEntidade: 'Rua X, 100',
  nomeRelatorio: 'Lançamentos',
  brasao: 'data:image/png;base64,AAAA',
  dataGeracao: '03/06/2026',
  horaGeracao: '14:00',
}

describe('montarTemplateFaixa', () => {
  it('faixa nula → span vazio (Playwright exige template não-nulo)', () => {
    expect(montarTemplateFaixa(null, DADOS)).toBe('<span></span>')
  })

  it('posiciona elementos e preenche cada tipo', () => {
    const faixa = {
      altura: 100,
      layout: [
        { tipo: 'BRASAO', x: 2, y: 10 },
        { tipo: 'NOME_ENTIDADE', x: 30, y: 10 },
        { tipo: 'NOME_RELATORIO', x: 30, y: 50 },
        { tipo: 'DATA_GERACAO', x: 80, y: 10 },
        { tipo: 'HORA_GERACAO', x: 80, y: 40 },
        { tipo: 'ENDERECO_ENTIDADE', x: 2, y: 70 },
        { tipo: 'NUMERO_PAGINA', x: 80, y: 70 },
        { tipo: 'DESCONHECIDO', x: 0, y: 0 },
      ],
    }
    const html = montarTemplateFaixa(faixa, DADOS)
    expect(html).toContain('left:2%;top:10%')
    expect(html).toContain('<img src="data:image/png;base64,AAAA"')
    expect(html).toContain('Prefeitura')
    expect(html).toContain('Lançamentos')
    expect(html).toContain('03/06/2026')
    expect(html).toContain('14:00')
    expect(html).toContain('Rua X, 100')
    expect(html).toContain('class="pageNumber"')
    expect(html).toContain('class="totalPages"')
    expect(html).toContain('height:100px')
  })

  it('BRASAO sem brasão fica vazio', () => {
    const html = montarTemplateFaixa({ altura: 80, layout: [{ tipo: 'BRASAO', x: 0, y: 0 }] }, { ...DADOS, brasao: null })
    expect(html).not.toContain('<img')
  })

  it('layout não-array é tratado como vazio', () => {
    const html = montarTemplateFaixa({ altura: 80, layout: { tipo: 'x' } as never }, DADOS)
    expect(html).toContain('height:80px')
    expect(html).not.toContain('top:')
  })

  it('dado ausente (undefined) é escapado como vazio', () => {
    const html = montarTemplateFaixa(
      { altura: 80, layout: [{ tipo: 'NOME_ENTIDADE', x: 0, y: 0 }] },
      { ...DADOS, nomeEntidade: undefined as never },
    )
    expect(html).toContain('left:0%;top:0%')
  })

  it('aplica a formatação do elemento e a altura do brasão', () => {
    const html = montarTemplateFaixa(
      {
        altura: 100,
        layout: [
          { tipo: 'NOME_ENTIDADE', x: 50, y: 10, fonte: 'serif', tamanho: 18, negrito: true, italico: true, sublinhado: true, alinhamento: 'centro' },
          { tipo: 'BRASAO', x: 2, y: 0, altura: 72 },
        ],
      },
      DADOS,
    )
    expect(html).toContain('transform:translateX(-50%)')
    expect(html).toContain('font-family:serif')
    expect(html).toContain('font-size:18px')
    expect(html).toContain('font-weight:bold')
    expect(html).toContain('font-style:italic')
    expect(html).toContain('text-decoration:underline')
    expect(html).toContain('max-height:72px')
  })
})

describe('estiloElemento', () => {
  it('só posição quando não há formatação (forma antiga)', () => {
    expect(estiloElemento({ tipo: 'NOME_ENTIDADE', x: 5, y: 10 })).toBe('position:absolute;left:5%;top:10%')
  })
  it('alinhamento muda a âncora via translateX', () => {
    expect(estiloElemento({ tipo: 'X', x: 50, y: 0, alinhamento: 'centro' })).toContain('transform:translateX(-50%)')
    expect(estiloElemento({ tipo: 'X', x: 100, y: 0, alinhamento: 'dir' })).toContain('transform:translateX(-100%)')
    expect(estiloElemento({ tipo: 'X', x: 0, y: 0, alinhamento: 'esq' })).not.toContain('transform')
  })
  it('fonte mono vira monospace; fonte desconhecida é ignorada', () => {
    expect(estiloElemento({ tipo: 'X', x: 0, y: 0, fonte: 'mono' })).toContain('font-family:monospace')
    expect(estiloElemento({ tipo: 'X', x: 0, y: 0, fonte: 'comic' })).not.toContain('font-family')
  })
})

describe('montarCorpoHtml', () => {
  it('renderiza título, colunas e linhas (datas em pt-BR)', () => {
    const html = montarCorpoHtml(
      { colunas: ['data', 'historico'], linhas: [[new Date('2026-01-15T00:00:00-03:00'), 'Empenho']] },
      'Meu Relatório',
    )
    expect(html).toContain('<h1>Meu Relatório</h1>')
    expect(html).toContain('<th>data</th>')
    expect(html).toContain('<td>15/01/2026</td>')
    expect(html).toContain('Empenho')
  })

  it('sem linhas mostra "Sem resultados" (colspan tolera 0 colunas)', () => {
    expect(montarCorpoHtml({ colunas: ['a'], linhas: [] }, 'X')).toContain('Sem resultados.')
    expect(montarCorpoHtml({ colunas: [], linhas: [] }, 'X')).toContain('colspan="1"')
  })

  it('célula nula vira vazio', () => {
    const html = montarCorpoHtml({ colunas: ['a', 'b'], linhas: [[null, 'ok']] }, 'X')
    expect(html).toContain('<td></td><td>ok</td>')
  })

  it('escapa conteúdo perigoso', () => {
    const html = montarCorpoHtml({ colunas: ['<script>'], linhas: [['<b>x</b>']] }, '<i>t</i>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('&lt;i&gt;t&lt;/i&gt;')
  })

  it('com coluna de valor e porPagina: subtotais (com quebra) + resumo no fim', () => {
    const r = { colunas: ['c', 'v'], linhas: [['a', '1'], ['b', '2'], ['c', '3'], ['d', '4']] }
    const html = montarCorpoHtml(r, 'X', 2) // 2 linhas/página → 2 páginas
    expect((html.match(/class="subtotal"/g) || []).length).toBe(2)
    expect(html).toContain('break-after:page') // quebra entre páginas (não na última)
    expect(html).toContain('Total de v: <strong>10</strong>')
  })

  it('sem porPagina, com coluna de valor: só o resumo (sem subtotal)', () => {
    const html = montarCorpoHtml({ colunas: ['c', 'v'], linhas: [['a', '10.5'], ['b', '4.5']] }, 'X')
    expect(html).toContain('class="resumo"')
    expect(html).not.toContain('class="subtotal"')
    expect(html).toContain('15.0') // 10.5 + 4.5, 1 casa
  })

  it('config do usuário: rótulo próprio, subtotal desligado e nota de parcial', () => {
    const r = { colunas: ['c', 'v'], linhas: [['a', '1'], ['b', '2'], ['c', '3'], ['d', '4']], truncado: true }
    const cfg = { subtotalPagina: false, itens: [{ coluna: 'v', agg: 'MEDIA' as const, rotulo: 'Média dos impostos' }] }
    const html = montarCorpoHtml(r, 'X', 2, cfg)
    expect(html).not.toContain('class="subtotal"')
    expect(html).toContain('Média dos impostos: <strong>2.50</strong>')
    expect(html).toContain('Valores parciais')
  })

  it('config sem itens: nem subtotal nem resumo', () => {
    const r = { colunas: ['c', 'v'], linhas: [['a', '1'], ['b', '2']] }
    const html = montarCorpoHtml(r, 'X', 1, { subtotalPagina: true, itens: [] })
    expect(html).not.toContain('class="subtotal"')
    expect(html).not.toContain('class="resumo"')
  })
})

describe('margemParaFaixa', () => {
  it('null → padrão; com faixa → altura px convertida em mm + folga', () => {
    expect(margemParaFaixa(null, 12)).toBe(12)
    expect(margemParaFaixa({ altura: 110, layout: [] }, 12)).toBe(Math.round((110 * 25.4) / 96) + 6)
  })
})
