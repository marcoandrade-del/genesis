import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ArrecadacoesService } from '../services/arrecadacoes.js'
import { SaldoOrcamentarioService } from '../services/saldo-orcamentario.js'
import { ProgramaTrabalhoService, type DimensaoPrograma } from '../services/programa-trabalho.js'
import {
  montarReceitaPrevista,
  montarDespesaFixada,
  montarProgramaTrabalho,
  montarSumarioGeral,
  documentoPdf,
  formatarEmissao,
  type FormatoCodigo,
} from '../services/relatorio-orcamento.js'
import { gerarPdf } from '../services/relatorio-pdf.js'

type EntidadeCab = {
  nome: string
  brasao: string | null
  municipio: { nome: string; estado: { sigla: string } }
}

const footer = (titulo: string, emissao = '') =>
  `<div style="font-size:8px;width:100%;text-align:center;color:#888;padding:0 12mm">` +
  `Gênesis · ${titulo}${emissao ? ` — Relatório gerado em ${emissao}` : ''} — ` +
  `página <span class="pageNumber"></span>/<span class="totalPages"></span></div>`

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
  type CabMeta = {
    legenda: string
    emissao: string
    emissaoLocal: 'CABECALHO' | 'RODAPE' | 'NENHUM'
    marcaDagua?: string
  }

  // Marca d'água por status (só quando NÃO é a versão final aprovada).
  const MARCA_POR_STATUS: Record<string, string> = { RASCUNHO: 'RASCUNHO', ENVIADO_AO_LEGISLATIVO: 'PROJETO DE LEI' }

  async function entidadeCtx(
    entidadeId: string,
    ano: number,
  ): Promise<{ e: EntidadeCab; padrao: FormatoCodigo; meta: CabMeta }> {
    const [row, orc] = await Promise.all([
      app.prisma.entidade.findUnique({
        where: { id: entidadeId },
        select: {
          nome: true,
          brasao: true,
          emissaoLocal: true,
          emitirData: true,
          emitirHora: true,
          municipio: {
            select: {
              nome: true,
              brasao: true,
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
    const marcaDagua = aprovado ? undefined : MARCA_POR_STATUS[orc?.status ?? ''] ?? 'VERSÃO TRANSITÓRIA'
    const meta: CabMeta = {
      legenda,
      emissao: formatarEmissao(new Date(), row!.emitirData, row!.emitirHora),
      emissaoLocal: row!.emissaoLocal,
      ...(marcaDagua ? { marcaDagua } : {}),
    }
    return {
      // Brasão do município tem prioridade; cai no da entidade se o município não tiver.
      e: { nome: row!.nome, brasao: m.brasao ?? row!.brasao, municipio: { nome: m.nome, estado: { sigla: m.estado.sigla } } },
      padrao: { modo, nivelMax },
      meta,
    }
  }

  const cab = (e: EntidadeCab, ano: number, meta: CabMeta) => ({
    entidadeNome: e.nome,
    municipio: e.municipio.nome,
    estado: e.municipio.estado.sigla,
    ano,
    brasao: e.brasao,
    ...meta,
  })

  // Carimbo p/ o rodapé por página do PDF (Playwright), só quando a entidade pede rodapé.
  const emissaoRodape = (meta: CabMeta) => (meta.emissaoLocal === 'RODAPE' ? meta.emissao : '')

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
    const [{ e, padrao, meta },resumo] = await Promise.all([entidadeCtx(entidadeId, ano), arrecadacoes.resumo(entidadeId, ano)])
    const fmt = fmtCodigo(req, padrao)
    const corpo = resumo.temOrcamento
      ? montarReceitaPrevista({
          cabecalho: cab(e, ano, meta),
          porConta: resumo.porConta,
          porFonte: resumo.porFonte,
          total: resumo.resumo.previsto,
          codigoConta: fmt,
        })
      : ''
    return { e, ano, temOrcamento: resumo.temOrcamento, corpo, fmt, meta }
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
    const { ano, temOrcamento, corpo, meta } = await receita(req)
    if (!temOrcamento) return reply.redirect('/app/orcamento/relatorios/receita-prevista')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`Receita Orçada ${ano}`, corpo),
      header: '<span></span>',
      footer: footer('Receita Orçada', emissaoRodape(meta)),
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
    const [{ e, padrao, meta },saldo] = await Promise.all([entidadeCtx(entidadeId, ano), saldoSvc.calcular(entidadeId, ano)])
    const fmt = fmtCodigo(req, padrao)
    const corpo = saldo.temOrcamento
      ? montarDespesaFixada({
          cabecalho: cab(e, ano, meta),
          porUnidade: saldo.porUnidade,
          porFuncao: saldo.porFuncao,
          porConta: saldo.porConta,
          porFonte: saldo.porFonte,
          total: saldo.resumo.autorizado,
          codigoConta: fmt,
        })
      : ''
    return { e, ano, temOrcamento: saldo.temOrcamento, corpo, fmt, meta }
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
    const { ano, temOrcamento, corpo, meta } = await despesa(req)
    if (!temOrcamento) return reply.redirect('/app/orcamento/relatorios/despesa-fixada')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`Despesa Fixada ${ano}`, corpo),
      header: '<span></span>',
      footer: footer('Despesa Fixada', emissaoRodape(meta)),
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="despesa-fixada-${ano}.pdf"`)
      .send(pdf)
  })

  // ── Anexos funcional-programáticos (Anexo 6, Anexo 7, Despesa por F/P/S) ─────
  // Cada um é a despesa fixada cruzada por uma ordem diferente de dimensões.
  type AnexoFP = {
    path: string
    tituloPagina: string
    breadcrumb: string
    filePrefix: string
    dims: DimensaoPrograma[]
    titulo: string
    descricao: string
  }

  async function corpoAnexoFP(req: FastifyRequest, a: AnexoFP) {
    const { entidadeId, ano } = req.contexto
    const [{ e, meta },pt] = await Promise.all([
      entidadeCtx(entidadeId, ano),
      ptSvc.calcularPor(entidadeId, ano, a.dims),
    ])
    const corpo = pt.temOrcamento
      ? montarProgramaTrabalho({
          cabecalho: cab(e, ano, meta),
          linhas: pt.linhas,
          total: pt.total,
          titulo: a.titulo,
          descricao: a.descricao,
        })
      : ''
    return { e, ano, temOrcamento: pt.temOrcamento, corpo, meta }
  }

  function registrarAnexoFP(a: AnexoFP) {
    app.get(`/orcamento/relatorios/${a.path}`, async (req, reply) => {
      const { e, ano, temOrcamento, corpo } = await corpoAnexoFP(req, a)
      return reply.view('app/relatorio-demonstrativo', {
        tituloPagina: a.tituloPagina,
        breadcrumb: a.breadcrumb,
        pdfUrl: `/app/orcamento/relatorios/${a.path}.pdf`,
        entidade: e,
        ano,
        nivel: req.contexto.nivel,
        temOrcamento,
        corpo,
        layout: null,
      })
    })
    app.get(`/orcamento/relatorios/${a.path}.pdf`, async (req, reply) => {
      const { ano, temOrcamento, corpo, meta } = await corpoAnexoFP(req, a)
      if (!temOrcamento) return reply.redirect(`/app/orcamento/relatorios/${a.path}`)
      const pdf = await gerarPdf({
        corpoHtml: documentoPdf(`${a.tituloPagina} ${ano}`, corpo),
        header: '<span></span>',
        footer: footer(a.tituloPagina, emissaoRodape(meta)),
        margemTopoMm: 12,
        margemRodapeMm: 16,
      })
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${a.filePrefix}-${ano}.pdf"`)
        .send(pdf)
    })
  }

  registrarAnexoFP({
    path: 'programa-trabalho',
    tituloPagina: 'Programa de Trabalho',
    breadcrumb: 'Programa de trabalho (LOA)',
    filePrefix: 'programa-trabalho',
    dims: ['uo', 'funcao', 'subfuncao', 'programa', 'acao'],
    titulo: 'Anexo 6, da Lei nº 4.320/64 — Programa de Trabalho',
    descricao: 'Despesa fixada por unidade orçamentária → função → subfunção → programa → ação.',
  })

  registrarAnexoFP({
    path: 'programa-governo',
    tituloPagina: 'Programa de Trabalho de Governo',
    breadcrumb: 'Programa de trabalho de governo (LOA)',
    filePrefix: 'programa-governo',
    dims: ['funcao', 'subfuncao', 'programa', 'acao'],
    titulo: 'Anexo 7, da Lei nº 4.320/64 — Programa de Trabalho de Governo',
    descricao: 'Despesa fixada por função → subfunção → programa → ação (consolidado, todo o governo).',
  })

  registrarAnexoFP({
    path: 'despesa-funcoes-programas',
    tituloPagina: 'Despesa por Funções, Programas e Subprogramas',
    breadcrumb: 'Despesa por funções, programas e subprogramas (LOA)',
    filePrefix: 'despesa-funcoes-programas',
    dims: ['funcao', 'programa', 'subfuncao'],
    titulo: 'Demonstrativo da Despesa por Funções, Programas e Subprogramas',
    descricao: 'Despesa fixada por função → programa → subfunção.',
  })

  // ── Sumário Geral (Receita por Fontes × Despesa por Funções) ────────────────
  async function sumario(req: FastifyRequest) {
    const { entidadeId, ano } = req.contexto
    const [{ e, meta },resumo, saldo] = await Promise.all([
      entidadeCtx(entidadeId, ano),
      arrecadacoes.resumo(entidadeId, ano),
      saldoSvc.calcular(entidadeId, ano),
    ])
    const temOrcamento = resumo.temOrcamento || saldo.temOrcamento
    const corpo = temOrcamento
      ? montarSumarioGeral({
          cabecalho: cab(e, ano, meta),
          receitaPorFonte: resumo.porFonte,
          despesaPorFuncao: saldo.porFuncao,
          totalReceita: resumo.resumo.previsto,
          totalDespesa: saldo.resumo.autorizado,
        })
      : ''
    return { e, ano, temOrcamento, corpo, meta }
  }

  app.get('/orcamento/relatorios/sumario', async (req, reply) => {
    const { e, ano, temOrcamento, corpo } = await sumario(req)
    return reply.view('app/relatorio-demonstrativo', {
      tituloPagina: 'Sumário Geral',
      breadcrumb: 'Sumário geral (LOA)',
      pdfUrl: '/app/orcamento/relatorios/sumario.pdf',
      entidade: e,
      ano,
      nivel: req.contexto.nivel,
      temOrcamento,
      corpo,
      layout: null,
    })
  })

  app.get('/orcamento/relatorios/sumario.pdf', async (req, reply) => {
    const { ano, temOrcamento, corpo, meta } = await sumario(req)
    if (!temOrcamento) return reply.redirect('/app/orcamento/relatorios/sumario')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`Sumário Geral ${ano}`, corpo),
      header: '<span></span>',
      footer: footer('Sumário Geral', emissaoRodape(meta)),
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="sumario-geral-${ano}.pdf"`)
      .send(pdf)
  })
}
