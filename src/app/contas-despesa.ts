import type { FastifyInstance } from 'fastify'
import { ContasDespesaEntidadeService } from '../services/contas-despesa-entidade.js'
import { SaldoOrcamentarioService } from '../services/saldo-orcamentario.js'
import { registrarRotasPlano } from './plano-entidade.js'

/**
 * Plano de Despesa (orçamentário) do operador. Mesmo desenho do plano contábil:
 * lista do exercício corrente + desdobrar/excluir desdobramento, reusando as
 * regras do service (modelo TCE imutável, só folha analítica desdobra).
 */
export async function appContasDespesaRoutes(app: FastifyInstance) {
  const servico = new ContasDespesaEntidadeService(app.prisma)
  const saldoDespesa = new SaldoOrcamentarioService(app.prisma)
  registrarRotasPlano(app, {
    rota: '/contas-despesa',
    titulo: 'Plano de Despesa',
    descricao: 'Contas de despesa do exercício',
    servico,
    listarFlat: (entidadeId, ano) =>
      app.prisma.contaDespesaEntidade.findMany({
        where: { entidadeId, ano },
        orderBy: { codigo: 'asc' },
        select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true, parentId: true },
      }),
    // Saldo por conta: autorizado × empenhado até a data = disponível (reusa o saldo orçamentário).
    saldoColunas: [
      { chave: 'autorizado', rotulo: 'Autorizado' },
      { chave: 'empenhado', rotulo: 'Empenhado' },
      { chave: 'disponivel', rotulo: 'Disponível' },
    ],
    saldoMapa: async (entidadeId, ano, dataRef) => {
      const s = await saldoDespesa.calcular(entidadeId, ano, dataRef)
      const mapa = new Map<string, Record<string, number>>()
      for (const l of s.porConta) mapa.set(l.id, { autorizado: l.autorizado, empenhado: l.empenhado, disponivel: l.disponivel })
      return mapa
    },
    // Desdobramento mensal por conta (empenhado/mês) — visão geral + conferência.
    mensalMapa: (entidadeId, ano) => saldoDespesa.empenhadoMensal(entidadeId, ano),
    mensalRotulo: 'Empenhado/mês',
    // Este plano é o cadastro/visão POR NATUREZA; a execução pela codificação
    // completa (funcional-programática) vive na tela de Execução da Despesa.
    subtitulo: 'Plano de contas por natureza (cadastro e consolidação por elemento)',
    analiseLink: { href: '/app/orcamento/despesa/execucao', rotulo: 'Execução (funcional-programática)' },
  })
}
