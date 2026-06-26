import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ArrecadacoesService } from '../services/arrecadacoes.js'
import { SaldoOrcamentarioService } from '../services/saldo-orcamentario.js'
import { montarReceitaPrevista, montarDespesaFixada, documentoPdf } from '../services/relatorio-orcamento.js'
import { gerarPdf } from '../services/relatorio-pdf.js'

type EntidadeCab = {
  nome: string
  brasao: string | null
  municipio: { nome: string; estado: { sigla: string } }
}

const footer = (titulo: string) =>
  `<div style="font-size:8px;width:100%;text-align:center;color:#888;padding:0 12mm">` +
  `Gênesis · ${titulo} — página <span class="pageNumber"></span>/<span class="totalPages"></span></div>`

/**
 * Relatórios imprimíveis do orçamento (LOA): demonstrativo da Receita Orçada e
 * da Despesa Fixada (hierárquicos, com roll-up reusado dos services de
 * arrecadação/saldo). Saída em tela imprimível + PDF (Playwright).
 */
export async function appRelatoriosOrcamentoRoutes(app: FastifyInstance) {
  const arrecadacoes = new ArrecadacoesService(app.prisma)
  const saldoSvc = new SaldoOrcamentarioService(app.prisma)

  async function entidadeCab(entidadeId: string): Promise<EntidadeCab> {
    return (await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { nome: true, brasao: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
    })) as EntidadeCab
  }

  const cab = (e: EntidadeCab, ano: number) => ({
    entidadeNome: e.nome,
    municipio: e.municipio.nome,
    estado: e.municipio.estado.sigla,
    ano,
    brasao: e.brasao,
  })

  // ── Receita Orçada ──────────────────────────────────────────────────────────
  async function receita(req: FastifyRequest) {
    const { entidadeId, ano } = req.contexto
    const [e, resumo] = await Promise.all([entidadeCab(entidadeId), arrecadacoes.resumo(entidadeId, ano)])
    const corpo = resumo.temOrcamento
      ? montarReceitaPrevista({
          cabecalho: cab(e, ano),
          porConta: resumo.porConta,
          porFonte: resumo.porFonte,
          total: resumo.resumo.previsto,
        })
      : ''
    return { e, ano, temOrcamento: resumo.temOrcamento, corpo }
  }

  app.get('/orcamento/relatorios/receita-prevista', async (req, reply) => {
    const { e, ano, temOrcamento, corpo } = await receita(req)
    return reply.view('app/relatorio-demonstrativo', {
      tituloPagina: 'Receita Orçada',
      breadcrumb: 'Receita orçada (LOA)',
      pdfUrl: '/app/orcamento/relatorios/receita-prevista.pdf',
      entidade: e,
      ano,
      nivel: req.contexto.nivel,
      temOrcamento,
      corpo,
      layout: null,
    })
  })

  app.get('/orcamento/relatorios/receita-prevista.pdf', async (req, reply) => {
    const { ano, temOrcamento, corpo } = await receita(req)
    if (!temOrcamento) return reply.redirect('/app/orcamento/relatorios/receita-prevista')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`Receita Orçada ${ano}`, corpo),
      header: '<span></span>',
      footer: footer('Receita Orçada'),
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="receita-orcada-${ano}.pdf"`)
      .send(pdf)
  })

  // ── Despesa Fixada ──────────────────────────────────────────────────────────
  async function despesa(req: FastifyRequest) {
    const { entidadeId, ano } = req.contexto
    const [e, saldo] = await Promise.all([entidadeCab(entidadeId), saldoSvc.calcular(entidadeId, ano)])
    const corpo = saldo.temOrcamento
      ? montarDespesaFixada({
          cabecalho: cab(e, ano),
          porUnidade: saldo.porUnidade,
          porFuncao: saldo.porFuncao,
          porConta: saldo.porConta,
          porFonte: saldo.porFonte,
          total: saldo.resumo.autorizado,
        })
      : ''
    return { e, ano, temOrcamento: saldo.temOrcamento, corpo }
  }

  app.get('/orcamento/relatorios/despesa-fixada', async (req, reply) => {
    const { e, ano, temOrcamento, corpo } = await despesa(req)
    return reply.view('app/relatorio-demonstrativo', {
      tituloPagina: 'Despesa Fixada',
      breadcrumb: 'Despesa fixada (LOA)',
      pdfUrl: '/app/orcamento/relatorios/despesa-fixada.pdf',
      entidade: e,
      ano,
      nivel: req.contexto.nivel,
      temOrcamento,
      corpo,
      layout: null,
    })
  })

  app.get('/orcamento/relatorios/despesa-fixada.pdf', async (req, reply) => {
    const { ano, temOrcamento, corpo } = await despesa(req)
    if (!temOrcamento) return reply.redirect('/app/orcamento/relatorios/despesa-fixada')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`Despesa Fixada ${ano}`, corpo),
      header: '<span></span>',
      footer: footer('Despesa Fixada'),
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="despesa-fixada-${ano}.pdf"`)
      .send(pdf)
  })
}
