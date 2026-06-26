import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ArrecadacoesService } from '../services/arrecadacoes.js'
import { montarReceitaPrevista, documentoPdf } from '../services/relatorio-orcamento.js'
import { gerarPdf } from '../services/relatorio-pdf.js'

const FOOTER =
  '<div style="font-size:8px;width:100%;text-align:center;color:#888;padding:0 12mm">' +
  'Gênesis · Demonstrativo da Receita Orçada — página <span class="pageNumber"></span>/<span class="totalPages"></span></div>'

type EntidadeCab = {
  nome: string
  brasao: string | null
  municipio: { nome: string; estado: { sigla: string } }
}

/**
 * Relatórios imprimíveis do orçamento (LOA). Começa pelo Demonstrativo da
 * Receita Orçada (por natureza, com roll-up, + por fonte) reusando o roll-up
 * já existente do `ArrecadacoesService`. Saída em tela (imprimível) e PDF.
 */
export async function appRelatoriosOrcamentoRoutes(app: FastifyInstance) {
  const arrecadacoes = new ArrecadacoesService(app.prisma)

  async function dados(req: FastifyRequest) {
    const { entidadeId, ano } = req.contexto
    const [entidade, resumo] = await Promise.all([
      app.prisma.entidade.findUnique({
        where: { id: entidadeId },
        select: { nome: true, brasao: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
      }),
      arrecadacoes.resumo(entidadeId, ano),
    ])
    return { entidade: entidade as EntidadeCab, ano, resumo }
  }

  const corpoReceita = (entidade: EntidadeCab, ano: number, resumo: Awaited<ReturnType<typeof arrecadacoes.resumo>>) =>
    montarReceitaPrevista({
      cabecalho: {
        entidadeNome: entidade.nome,
        municipio: entidade.municipio.nome,
        estado: entidade.municipio.estado.sigla,
        ano,
        brasao: entidade.brasao,
      },
      porConta: resumo.porConta,
      porFonte: resumo.porFonte,
      total: resumo.resumo.previsto,
    })

  // ── Tela imprimível ─────────────────────────────────────────────────────────
  app.get('/orcamento/relatorios/receita-prevista', async (req, reply) => {
    const { entidade, ano, resumo } = await dados(req)
    return reply.view('app/relatorio-receita-prevista', {
      entidade,
      ano,
      nivel: req.contexto.nivel,
      temOrcamento: resumo.temOrcamento,
      corpo: resumo.temOrcamento ? corpoReceita(entidade, ano, resumo) : '',
      layout: null,
    })
  })

  // ── PDF (Playwright) ────────────────────────────────────────────────────────
  app.get('/orcamento/relatorios/receita-prevista.pdf', async (req, reply) => {
    const { entidade, ano, resumo } = await dados(req)
    if (!resumo.temOrcamento) return reply.redirect('/app/orcamento/relatorios/receita-prevista')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`Receita Orçada ${ano}`, corpoReceita(entidade, ano, resumo)),
      header: '<span></span>',
      footer: FOOTER,
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="receita-orcada-${ano}.pdf"`)
      .send(pdf)
  })
}
