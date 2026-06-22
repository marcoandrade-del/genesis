import { describe, it, expect } from 'vitest'
import { montarTemplateFaixa, montarCorpoHtml, margemParaFaixa } from '../relatorio-pdf.js'

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

  it('aplica formatação por elemento (fonte/estilo/âncora) e dimensões do brasão', () => {
    const faixa = {
      altura: 120,
      layout: [
        { tipo: 'NOME_ENTIDADE', x: 50, y: 10, fonte: 'Arial', tamanho: 16, negrito: true, italico: true, sublinhado: true, alinhamento: 'center' },
        { tipo: 'NUMERO_PAGINA', x: 98, y: 90, alinhamento: 'right' },
        { tipo: 'BRASAO', x: 2, y: 10, brasaoLargura: 80, brasaoAltura: 60 },
      ],
    }
    const html = montarTemplateFaixa(faixa, DADOS)
    expect(html).toContain('font-family:Arial')
    expect(html).toContain('font-size:16px')
    expect(html).toContain('font-weight:bold')
    expect(html).toContain('font-style:italic')
    expect(html).toContain('text-decoration:underline')
    expect(html).toContain('transform:translateX(-50%)') // alinhamento center
    expect(html).toContain('transform:translateX(-100%)') // alinhamento right
    expect(html).toContain('width:80px;height:60px') // brasão dimensionado
  })

  it('elemento sem formatação não injeta estilos extras', () => {
    const html = montarTemplateFaixa({ altura: 80, layout: [{ tipo: 'DATA_GERACAO', x: 10, y: 10 }] }, DADOS)
    expect(html).toContain('left:10%;top:10%"')
    expect(html).not.toContain('font-weight')
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

  it('com coluna de valor e porPagina: subtotais (com quebra) + total geral', () => {
    const r = { colunas: ['c', 'v'], linhas: [['a', '1'], ['b', '2'], ['c', '3'], ['d', '4']] }
    const html = montarCorpoHtml(r, 'X', 2) // 2 linhas/página → 2 páginas
    expect((html.match(/class="subtotal"/g) || []).length).toBe(2)
    expect(html).toContain('break-after:page') // quebra entre páginas (não na última)
    expect(html).toContain('class="total"')
  })

  it('sem porPagina, com coluna de valor: só total geral (sem subtotal)', () => {
    const html = montarCorpoHtml({ colunas: ['c', 'v'], linhas: [['a', '10.5'], ['b', '4.5']] }, 'X')
    expect(html).toContain('class="total"')
    expect(html).not.toContain('class="subtotal"')
    expect(html).toContain('15.0') // 10.5 + 4.5, 1 casa
  })
})

describe('margemParaFaixa', () => {
  it('null → padrão; com faixa → altura px convertida em mm + folga', () => {
    expect(margemParaFaixa(null, 12)).toBe(12)
    expect(margemParaFaixa({ altura: 110, layout: [] }, 12)).toBe(Math.round((110 * 25.4) / 96) + 6)
  })
})
