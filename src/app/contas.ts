import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { ContasContabilEntidadeService } from '../services/contas-contabil-entidade.js'
import { SaldoContabilService } from '../services/saldo-contabil.js'
import { RazaoContabilService, type Razao } from '../services/razao-contabil.js'
import { SaldoDiarioService } from '../services/saldo-diario.js'
import { DesdobramentoDistribuicaoService, type FilhoNovo, type Distribuicao } from '../services/desdobramento-distribuicao.js'
import type { Natureza } from '../services/saldo-contabil.js'
import { ErroNegocio, statusDeErro } from '../errors.js'
import { registrarRotasPlano } from './plano-entidade.js'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const podeEscreverNivel = (nivel: string) => nivel === 'ESCRITA' || nivel === 'ADMIN'
const dec = (v: unknown) => new Prisma.Decimal(String(v ?? '0') || '0')

/**
 * Plano de Contas (contábil/patrimonial) do operador. Lista o plano da entidade
 * no exercício corrente (escopo via `req.contexto`, sem picker) e permite
 * desdobrar conta analítica / excluir desdobramento — mesmas regras do /admin.
 * Inclui o drill-down de razão (resumo mensal → total por dia → movimentos).
 */
export async function appContasRoutes(app: FastifyInstance) {
  const servico = new ContasContabilEntidadeService(app.prisma)
  registrarRotasPlano(app, {
    rota: '/contas',
    titulo: 'Plano de Contas (contábil)',
    descricao: 'Contas contábeis do exercício',
    servico,
    saldos: new SaldoContabilService(app.prisma),
    listarFlat: (entidadeId, ano) =>
      app.prisma.contaContabilEntidade.findMany({
        where: { entidadeId, ano },
        orderBy: { codigo: 'asc' },
        select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true, parentId: true },
      }),
  })

  // ── Razão da conta (drill-down): resumo mensal + total por dia + movimentos ──
  const razaoSvc = new RazaoContabilService(app.prisma)

  app.get<{ Params: { id: string }; Querystring: { mes?: string } }>('/contas/:id/razao', async (req, reply) => {
    const { entidadeId, ano } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')

    const conta = await app.prisma.contaContabilEntidade.findUnique({
      where: { id: req.params.id },
      select: { id: true, codigo: true, descricao: true, entidadeId: true, modeloContaId: true },
    })
    if (!conta || conta.entidadeId !== entidadeId) return reply.redirect('/app/contas')

    const modelo = conta.modeloContaId
      ? await app.prisma.conta.findUnique({ where: { id: conta.modeloContaId }, select: { naturezaSaldo: true } })
      : null
    const natureza = (modelo?.naturezaSaldo as Natureza | null) ?? null

    const mesNum = Number(req.query.mes)
    const mes = Number.isInteger(mesNum) && mesNum >= 1 && mesNum <= 12 ? mesNum : new Date().getMonth() + 1

    const [resumo, razao] = await Promise.all([
      razaoSvc.resumoMensal(entidadeId, conta.id, ano),
      razaoSvc.razaoDoMes(entidadeId, conta.id, ano, mes, natureza),
    ])

    const n = (d: { toNumber(): number }) => d.toNumber()
    const dia2 = (d: Date) => String(d.getUTCDate()).padStart(2, '0')
    const r: Razao = razao
    return reply.view('app/razao', {
      entidade,
      ano,
      conta,
      natureza,
      mes,
      meses: MESES,
      resumo: resumo.map((m) => ({ mes: m.mes, nome: MESES[m.mes - 1], debito: n(m.debito), credito: n(m.credito) })),
      saldoAnterior: n(r.saldoAnterior),
      saldoFinal: n(r.saldoFinal),
      totalDebito: n(r.totalDebito),
      totalCredito: n(r.totalCredito),
      movimentos: r.movimentos.map((m) => ({
        dia: dia2(m.data),
        historico: m.historico,
        debito: n(m.debito),
        credito: n(m.credito),
        saldo: n(m.saldo),
        origemTipo: m.origemTipo ?? null,
        origemId: m.origemId ?? null,
        eventoCodigo: m.eventoCodigo ?? null,
      })),
      totaisPorDia: r.totaisPorDia.map((t) => ({ dia: String(t.dia).padStart(2, '0'), debito: n(t.debito), credito: n(t.credito) })),
      layout: null,
    })
  })

  // ── Acumulado diário da conta: série do saldo corrido dia a dia (materializado) ──
  const saldoDiarioSvc = new SaldoDiarioService(app.prisma)

  app.get<{ Params: { id: string } }>('/contas/:id/diario', async (req, reply) => {
    const { entidadeId, ano } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')

    const conta = await app.prisma.contaContabilEntidade.findUnique({
      where: { id: req.params.id },
      select: { id: true, codigo: true, descricao: true, entidadeId: true },
    })
    if (!conta || conta.entidadeId !== entidadeId) return reply.redirect('/app/contas')

    const serie = await saldoDiarioSvc.serie(entidadeId, conta.id, ano)
    const n = (d: { toNumber(): number }) => d.toNumber()
    const dataBR = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
    return reply.view('app/diario', {
      entidade, ano, conta,
      natureza: serie.natureza,
      saldoInicial: n(serie.saldoInicial),
      totalDebito: n(serie.totalDebito),
      totalCredito: n(serie.totalCredito),
      saldoFinal: n(serie.saldoFinal),
      dias: serie.dias.map((d) => ({ data: dataBR(d.data), debito: n(d.debito), credito: n(d.credito), saldo: n(d.saldoAcumulado) })),
      layout: null,
    })
  })

  // ── Desdobrar com distribuição (épico #85): redistribui movimentos+saldo ──
  const distribuirSvc = new DesdobramentoDistribuicaoService(app.prisma)

  /** Carrega a conta-mãe + saldo inicial + movimentos do exercício para o fluxo. */
  async function carregarDistribuir(entidadeId: string, ano: number, contaId: string) {
    const conta = await app.prisma.contaContabilEntidade.findUnique({
      where: { id: contaId },
      select: { id: true, codigo: true, descricao: true, entidadeId: true, admiteMovimento: true },
    })
    if (!conta || conta.entidadeId !== entidadeId || !conta.admiteMovimento) return null
    const [si, itens] = await Promise.all([
      app.prisma.saldoInicialAno.findUnique({ where: { entidadeId_contaId_ano: { entidadeId, contaId, ano } }, select: { valor: true } }),
      app.prisma.lancamentoItem.findMany({
        where: { contaId },
        select: { id: true, tipo: true, valor: true, lancamento: { select: { data: true, historico: true } } },
        orderBy: [{ lancamento: { data: 'asc' } }, { id: 'asc' }],
      }),
    ])
    const saldoInicial = si ? si.valor.toNumber() : 0
    const movimentos = itens.map((it) => ({
      id: it.id,
      data: it.lancamento.data.toISOString().slice(0, 10),
      historico: it.lancamento.historico,
      tipo: it.tipo,
      valor: it.valor.toNumber(),
    }))
    return { conta, saldoInicial, movimentos }
  }

  app.get<{ Params: { id: string } }>('/contas/:id/distribuir', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')
    if (!podeEscreverNivel(nivel)) return reply.redirect('/app/contas')

    const dados = await carregarDistribuir(entidadeId, ano, req.params.id)
    if (!dados) return reply.redirect('/app/contas')
    return reply.view('app/distribuir', { entidade, ano, ...dados, erro: null, layout: null })
  })

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/contas/:id/distribuir', async (req, reply) => {
    const { entidadeId, ano, nivel } = req.contexto
    const entidade = await app.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { sigla: true, nome: true } } } } },
    })
    if (!entidade) return reply.clearCookie('genesis_exercicio', { path: '/' }).redirect('/app/contexto')

    const dados = await carregarDistribuir(entidadeId, ano, req.params.id)
    if (!dados) return reply.redirect('/app/contas')

    const reRender = (erro: string, status: number) => {
      reply.code(status)
      return reply.view('app/distribuir', { entidade, ano, ...dados, erro, layout: null })
    }
    if (!podeEscreverNivel(nivel)) return reRender('Acesso somente leitura nesta entidade.', 403)

    const body = req.body ?? {}
    let filhos: FilhoNovo[] = []
    const distribuicao: Distribuicao = {}
    try {
      const fRaw = JSON.parse(String(body['filhos'] ?? '[]')) as { codigo?: string; descricao?: string; saldoInicial?: string }[]
      filhos = fRaw.map((f) => ({ codigo: String(f.codigo ?? ''), descricao: String(f.descricao ?? ''), saldoInicial: dec(f.saldoInicial) }))
      const dRaw = JSON.parse(String(body['distribuicao'] ?? '{}')) as Record<string, Record<string, string>>
      for (const [itemId, partes] of Object.entries(dRaw)) {
        distribuicao[itemId] = {}
        for (const [codigo, valor] of Object.entries(partes)) distribuicao[itemId][codigo] = dec(valor)
      }
    } catch {
      return reRender('Dados do formulário inválidos.', 400)
    }

    try {
      await distribuirSvc.executar(dados.conta.id, filhos, distribuicao)
      return reply.redirect('/app/contas')
    } catch (e) {
      if (e instanceof ErroNegocio) return reRender(e.message, statusDeErro(e.code))
      throw e
    }
  })
}
