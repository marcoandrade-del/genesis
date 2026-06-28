import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ArrecadacoesService } from '../services/arrecadacoes.js'
import { SaldoOrcamentarioService } from '../services/saldo-orcamentario.js'
import { ProgramaTrabalhoService, type DimensaoPrograma } from '../services/programa-trabalho.js'
import { RclService, resolverComposicao } from '../services/rcl.js'
import { RclConsolidadaService } from '../services/rcl-consolidada.js'
import { MemorialGuardiaoService } from '../services/memorial-guardiao.js'
import {
  montarReceitaPrevista,
  montarDespesaFixada,
  montarProgramaTrabalho,
  montarSumarioGeral,
  montarRcl,
  montarRclConsolidada,
  montarGuardiao,
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
  const rclSvc = new RclService(app.prisma)
  const rclConsSvc = new RclConsolidadaService(app.prisma)
  const guardiaoSvc = new MemorialGuardiaoService(app.prisma)

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
  ): Promise<{ e: EntidadeCab; padrao: FormatoCodigo; meta: CabMeta; estadoRclComposicao: unknown }> {
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
              estado: { select: { sigla: true, loaCodigoModo: true, loaCodigoNivel: true, rclComposicao: true } },
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
      estadoRclComposicao: m.estado.rclComposicao,
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

  // ── Índice dos Anexos da LOA (landing do menu próprio) ──────────────────────
  app.get('/orcamento/relatorios', async (req, reply) => {
    const { entidadeId, ano } = req.contexto
    const { e } = await entidadeCtx(entidadeId, ano)
    return reply.view('app/relatorios-loa', { entidade: e, ano, nivel: req.contexto.nivel, layout: null })
  })

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

  // ── RCL (LRF / RREO Anexo 3) — receitas correntes − deduções ────────────────
  async function rcl(req: FastifyRequest) {
    const { entidadeId, ano } = req.contexto
    const { e, meta, estadoRclComposicao } = await entidadeCtx(entidadeId, ano)
    const comp = resolverComposicao(e.municipio.estado.sigla, estadoRclComposicao)
    const r = await rclSvc.calcular(entidadeId, ano, comp)
    const num = (d: { toNumber(): number }) => d.toNumber()
    const corpo = r.temOrcamento
      ? montarRcl({
          cabecalho: cab(e, ano, meta),
          correntes: r.correntes.map((l) => ({ codigo: l.codigo, rotulo: l.rotulo, valor: num(l.valor) })),
          correntesTotal: num(r.correntesTotal),
          deducoes: r.deducoes.map((l) => ({ codigo: l.codigo, rotulo: l.rotulo, valor: num(l.valor) })),
          deducoesTotal: num(r.deducoesTotal),
          rcl: num(r.rcl),
          nota: comp.nome,
        })
      : ''
    return { e, ano, temOrcamento: r.temOrcamento, corpo, meta }
  }

  app.get('/orcamento/relatorios/rcl', async (req, reply) => {
    const { e, ano, temOrcamento, corpo } = await rcl(req)
    return reply.view('app/relatorio-demonstrativo', {
      tituloPagina: 'Receita Corrente Líquida',
      breadcrumb: 'RCL (LRF)',
      pdfUrl: '/app/orcamento/relatorios/rcl.pdf',
      entidade: e,
      ano,
      nivel: req.contexto.nivel,
      temOrcamento,
      corpo,
      layout: null,
    })
  })

  app.get('/orcamento/relatorios/rcl.pdf', async (req, reply) => {
    const { ano, temOrcamento, corpo, meta } = await rcl(req)
    if (!temOrcamento) return reply.redirect('/app/orcamento/relatorios/rcl')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`RCL ${ano}`, corpo),
      header: '<span></span>',
      footer: footer('Receita Corrente Líquida', emissaoRodape(meta)),
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="rcl-${ano}.pdf"`)
      .send(pdf)
  })

  // ── RCL Consolidada do município (soma as entidades) ────────────────────────
  async function rclConsolidada(req: FastifyRequest) {
    const { entidadeId, ano } = req.contexto
    const [{ e, meta }, ent] = await Promise.all([
      entidadeCtx(entidadeId, ano),
      app.prisma.entidade.findUnique({ where: { id: entidadeId }, select: { municipioId: true } }),
    ])
    const cons = await rclConsSvc.calcular(ent!.municipioId, ano)
    const num = (d: { toNumber(): number }) => d.toNumber()
    const temOrcamento = cons.entidades.some((x) => x.temOrcamento)
    const corpo = temOrcamento
      ? montarRclConsolidada({
          cabecalho: cab(e, ano, meta),
          entidades: cons.entidades.map((x) => ({ nome: x.nome, correntes: num(x.correntes), deducoes: num(x.deducoes), rcl: num(x.rcl) })),
          correntesTotal: num(cons.correntesTotal),
          deducoesTotal: num(cons.deducoesTotal),
          intra: num(cons.intra),
          rclTotal: num(cons.rclTotal),
          metodologia: cons.metodologia,
        })
      : ''
    return { e, ano, temOrcamento, corpo, meta }
  }

  app.get('/orcamento/relatorios/rcl-consolidada', async (req, reply) => {
    const { e, ano, temOrcamento, corpo } = await rclConsolidada(req)
    return reply.view('app/relatorio-demonstrativo', {
      tituloPagina: 'RCL Consolidada do Município',
      breadcrumb: 'RCL consolidada (LRF)',
      pdfUrl: '/app/orcamento/relatorios/rcl-consolidada.pdf',
      entidade: e,
      ano,
      nivel: req.contexto.nivel,
      temOrcamento,
      corpo,
      layout: null,
    })
  })

  app.get('/orcamento/relatorios/rcl-consolidada.pdf', async (req, reply) => {
    const { ano, temOrcamento, corpo, meta } = await rclConsolidada(req)
    if (!temOrcamento) return reply.redirect('/app/orcamento/relatorios/rcl-consolidada')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`RCL Consolidada ${ano}`, corpo),
      header: '<span></span>',
      footer: footer('RCL Consolidada do Município', emissaoRodape(meta)),
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="rcl-consolidada-${ano}.pdf"`)
      .send(pdf)
  })

  // ── Guardião LRF — indicadores fiscais (RCL, Pessoal, aplicação por função) ──
  async function guardiao(req: FastifyRequest) {
    const { entidadeId, ano } = req.contexto
    const [{ e, meta }, g] = await Promise.all([entidadeCtx(entidadeId, ano), guardiaoSvc.guardiao(entidadeId, ano)])
    const temOrcamento = !!g?.temOrcamento && g.indicadores.length > 0
    const corpo = temOrcamento
      ? montarGuardiao({
          cabecalho: cab(e, ano, meta),
          metodologia: g!.metodologia,
          indicadores: g!.indicadores.map((i) => ({
            indicador: i.indicador,
            unidade: i.unidade,
            valor: i.valor,
            base: i.base,
            percentual: i.percentual,
            limite: i.limite,
            nivel: i.nivel,
            memorial: { descricao: i.memorial.descricao, baseLegal: i.memorial.baseLegal },
          })),
        })
      : ''
    return { e, ano, temOrcamento, corpo, meta }
  }

  app.get('/orcamento/relatorios/guardiao', async (req, reply) => {
    const { e, ano, temOrcamento, corpo } = await guardiao(req)
    return reply.view('app/relatorio-demonstrativo', {
      tituloPagina: 'Guardião LRF',
      breadcrumb: 'Guardião LRF',
      pdfUrl: '/app/orcamento/relatorios/guardiao.pdf',
      entidade: e,
      ano,
      nivel: req.contexto.nivel,
      temOrcamento,
      corpo,
      layout: null,
    })
  })

  app.get('/orcamento/relatorios/guardiao.pdf', async (req, reply) => {
    const { ano, temOrcamento, corpo, meta } = await guardiao(req)
    if (!temOrcamento) return reply.redirect('/app/orcamento/relatorios/guardiao')
    const pdf = await gerarPdf({
      corpoHtml: documentoPdf(`Guardião LRF ${ano}`, corpo),
      header: '<span></span>',
      footer: footer('Guardião LRF', emissaoRodape(meta)),
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="guardiao-lrf-${ano}.pdf"`)
      .send(pdf)
  })
}
