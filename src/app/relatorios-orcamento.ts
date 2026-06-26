import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ArrecadacoesService } from '../services/arrecadacoes.js'
import { SaldoOrcamentarioService } from '../services/saldo-orcamentario.js'
import { ProgramaTrabalhoService } from '../services/programa-trabalho.js'
import {
  montarReceitaPrevista,
  montarDespesaFixada,
  montarProgramaTrabalho,
  documentoPdf,
  type FormatoCodigo,
} from '../services/relatorio-orcamento.js'
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
  const ptSvc = new ProgramaTrabalhoService(app.prisma)

  // Busca o cabeçalho + o padrão de código HERDADO (município sobrescreve estado)
  // + a legenda legal (status/lei do orçamento).
  async function entidadeCtx(
    entidadeId: string,
    ano: number,
  ): Promise<{ e: EntidadeCab; padrao: FormatoCodigo; legenda: string }> {
    const [row, orc] = await Promise.all([
      app.prisma.entidade.findUnique({
        where: { id: entidadeId },
        select: {
          nome: true,
          brasao: true,
          municipio: {
            select: {
              nome: true,
              loaCodigoModo: true,
              loaCodigoNivel: true,
              estado: { select: { sigla: true, loaCodigoModo: true, loaCodigoNivel: true } },
            },
          },
        },
      }),
      app.prisma.orcamento.findUnique({
        where: { entidadeId_ano: { entidadeId, ano } },
        select: { status: true, leiNumero: true },
      }),
    ])
    const m = row!.municipio
    const enumModo = m.loaCodigoModo ?? m.estado.loaCodigoModo
    const modo = enumModo === 'COMPLETO' ? 'completo' : enumModo === 'NIVEL' ? 'nivel' : 'curto'
    const nivelMax = m.loaCodigoNivel ?? m.estado.loaCodigoNivel
    const aprovado = ['APROVADO', 'PUBLICADO', 'EM_EXECUCAO'].includes(orc?.status ?? '')
    const legenda =
      aprovado && orc?.leiNumero ? `Lei Orçamentária Anual nº ${orc.leiNumero}` : 'Projeto de Lei Orçamentária Anual'
    return {
      e: { nome: row!.nome, brasao: row!.brasao, municipio: { nome: m.nome, estado: { sigla: m.estado.sigla } } },
      padrao: { modo, nivelMax },
      legenda,
    }
  }

  const cab = (e: EntidadeCab, ano: number, legenda: string) => ({
    entidadeNome: e.nome,
    municipio: e.municipio.nome,
    estado: e.municipio.estado.sigla,
    ano,
    brasao: e.brasao,
    legenda,
  })

  // Query da tela (override pontual) tem prioridade sobre o padrão herdado.
  function fmtCodigo(req: FastifyRequest, padrao: FormatoCodigo): FormatoCodigo {
    const q = req.query as { cod?: string; nivelMax?: string }
    if (q.cod !== 'completo' && q.cod !== 'curto' && q.cod !== 'nivel') return padrao
    const nivelMax = Math.min(12, Math.max(1, parseInt(q.nivelMax ?? '', 10) || padrao.nivelMax))
    return { modo: q.cod, nivelMax }
  }

  const qsCodigo = (f: FormatoCodigo) => `?cod=${f.modo}${f.modo === 'nivel' ? `&nivelMax=${f.nivelMax}` : ''}`

  // ── Receita Orçada ──────────────────────────────────────────────────────────
  async function receita(req: FastifyRequest) {
    const { entidadeId, ano } = req.contexto
    const [{ e, padrao, legenda }, resumo] = await Promise.all([entidadeCtx(entidadeId, ano), arrecadacoes.resumo(entidadeId, ano)])
    const fmt = fmtCodigo(req, padrao)
    const corpo = resumo.temOrcamento
      ? montarReceitaPrevista({
          cabecalho: cab(e, ano, legenda),
          porConta: resumo.porConta,
          porFonte: resumo.porFonte,
          total: resumo.resumo.previsto,
          codigoConta: fmt,
        })
      : ''
    return { e, ano, temOrcamento: resumo.temOrcamento, corpo, fmt }
  }

  app.get('/orcamento/relatorios/receita-prevista', async (req, reply) => {
    const { e, ano, temOrcamento, corpo, fmt } = await receita(req)
    return reply.view('app/relatorio-demonstrativo', {
      tituloPagina: 'Receita Orçada',
      breadcrumb: 'Receita orçada (LOA)',
      pdfUrl: '/app/orcamento/relatorios/receita-prevista.pdf' + qsCodigo(fmt),
      seletorCodigo: fmt,
      seletorCodigoAcao: '/app/orcamento/relatorios/receita-prevista',
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
    const [{ e, padrao, legenda }, saldo] = await Promise.all([entidadeCtx(entidadeId, ano), saldoSvc.calcular(entidadeId, ano)])
    const fmt = fmtCodigo(req, padrao)
    const corpo = saldo.temOrcamento
      ? montarDespesaFixada({
          cabecalho: cab(e, ano, legenda),
          porUnidade: saldo.porUnidade,
          porFuncao: saldo.porFuncao,
          porConta: saldo.porConta,
          porFonte: saldo.porFonte,
          total: saldo.resumo.autorizado,
          codigoConta: fmt,
        })
      : ''
    return { e, ano, temOrcamento: saldo.temOrcamento, corpo, fmt }
  }

  app.get('/orcamento/relatorios/despesa-fixada', async (req, reply) => {
    const { e, ano, temOrcamento, corpo, fmt } = await despesa(req)
    return reply.view('app/relatorio-demonstrativo', {
      tituloPagina: 'Despesa Fixada',
      breadcrumb: 'Despesa fixada (LOA)',
      pdfUrl: '/app/orcamento/relatorios/despesa-fixada.pdf' + qsCodigo(fmt),
      seletorCodigo: fmt,
      seletorCodigoAcao: '/app/orcamento/relatorios/despesa-fixada',
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

  // ── Programa de Trabalho (Anexo 6 / QDD) ────────────────────────────────────
  async function programa(req: FastifyRequest) {
    const { entidadeId, ano } = req.contexto
    const [{ e, legenda }, pt] = await Promise.all([entidadeCtx(entidadeId, ano), ptSvc.calcular(entidadeId, ano)])
    const corpo = pt.temOrcamento
      ? montarProgramaTrabalho({ cabecalho: cab(e, ano, legenda), linhas: pt.linhas, total: pt.total })
      : ''
    return { e, ano, temOrcamento: pt.temOrcamento, corpo }
  }

  app.get('/orcamento/relatorios/programa-trabalho', async (req, reply) => {
    const { e, ano, temOrcamento, corpo } = await programa(req)
    return reply.view('app/relatorio-demonstrativo', {
      tituloPagina: 'Programa de Trabalho',
      breadcrumb: 'Programa de trabalho (LOA)',
      pdfUrl: '/app/orcamento/relatorios/programa-trabalho.pdf',
      entidade: e,
      ano,
      nivel: req.contexto.nivel,
      temOrcamento,
      corpo,
      layout: null,
    })
  })

  app.get('/orcamento/relatorios/programa-trabalho.pdf', async (req, reply) => {
    const { ano, temOrcamento, corpo } = await programa(req)
    if (!temOrcamento) return reply.redirect('/app/orcamento/relatorios/programa-trabalho')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`Programa de Trabalho ${ano}`, corpo),
      header: '<span></span>',
      footer: footer('Programa de Trabalho'),
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="programa-trabalho-${ano}.pdf"`)
      .send(pdf)
  })
}
