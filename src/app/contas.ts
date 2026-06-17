import type { FastifyInstance } from 'fastify'
import { ContasContabilEntidadeService } from '../services/contas-contabil-entidade.js'
import { SaldoContabilService } from '../services/saldo-contabil.js'
import { RazaoContabilService, type Razao } from '../services/razao-contabil.js'
import type { Natureza } from '../services/saldo-contabil.js'
import { registrarRotasPlano } from './plano-entidade.js'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

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
      movimentos: r.movimentos.map((m) => ({ dia: dia2(m.data), historico: m.historico, debito: n(m.debito), credito: n(m.credito), saldo: n(m.saldo) })),
      totaisPorDia: r.totaisPorDia.map((t) => ({ dia: String(t.dia).padStart(2, '0'), debito: n(t.debito), credito: n(t.credito) })),
      layout: null,
    })
  })
}
