import { PrismaClient } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { validarQuery } from './relatorio-executor.js'
import { validarTotaisConfig } from './relatorio-totais.js'

type DadosRelatorio = {
  nome?: unknown
  descricao?: unknown
  query?: unknown
  cabecalhoId?: unknown
  rodapeId?: unknown
}

const NOME_MAX = 120
const QUERY_MAX = 20000

function normNome(nome: unknown): string {
  const v = typeof nome === 'string' ? nome.trim() : ''
  if (!v) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe o nome do relatório.')
  if (v.length > NOME_MAX) throw new ErroNegocio('REQUISICAO_INVALIDA', `Nome muito longo (máx. ${NOME_MAX}).`)
  return v
}

function normDescricao(descricao: unknown): string | null {
  const v = typeof descricao === 'string' ? descricao.trim() : ''
  return v ? v : null
}

// A query é obrigatória e precisa ser uma instrução de leitura válida.
function normQuery(query: unknown): string {
  const v = typeof query === 'string' ? query.trim() : ''
  if (!v) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Escreva a query do relatório.')
  if (v.length > QUERY_MAX) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Query muito longa.')
  return validarQuery(v)
}

function normId(id: unknown): string | null {
  const v = typeof id === 'string' ? id.trim() : ''
  return v ? v : null
}

/**
 * CRUD dos relatórios do operador ("Meus Relatórios"). Cada relatório pertence
 * ao usuário (dono) e à entidade do contexto. Cabeçalho/rodapé escolhidos
 * precisam ser templates da mesma entidade.
 */
export class MeusRelatoriosService {
  constructor(private prisma: PrismaClient) {}

  listar(usuarioId: string, entidadeId: string) {
    return this.prisma.relatorioPersonalizado.findMany({
      where: { usuarioId, entidadeId },
      orderBy: { nome: 'asc' },
    })
  }

  buscar(id: string) {
    return this.prisma.relatorioPersonalizado.findUnique({
      where: { id },
      include: { cabecalho: true, rodape: true },
    })
  }

  async criar(usuarioId: string, entidadeId: string, dados: DadosRelatorio) {
    const nome = normNome(dados.nome)
    const query = normQuery(dados.query)
    const { cabecalhoId, rodapeId } = await this.validarTemplates(entidadeId, dados)
    return this.prisma.relatorioPersonalizado.create({
      data: {
        usuarioId,
        entidadeId,
        nome,
        descricao: normDescricao(dados.descricao),
        query,
        cabecalhoId,
        rodapeId,
        configuracao: {},
      },
    })
  }

  async atualizar(id: string, usuarioId: string, entidadeId: string, dados: DadosRelatorio) {
    const atual = await this.prisma.relatorioPersonalizado.findUnique({ where: { id } })
    if (!atual || atual.usuarioId !== usuarioId || atual.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Relatório não encontrado.')
    }
    const nome = normNome(dados.nome)
    const query = normQuery(dados.query)
    const { cabecalhoId, rodapeId } = await this.validarTemplates(entidadeId, dados)
    return this.prisma.relatorioPersonalizado.update({
      where: { id },
      data: { nome, descricao: normDescricao(dados.descricao), query, cabecalhoId, rodapeId },
    })
  }

  /**
   * Salva a configuração de totais do relatório em `configuracao.totais`
   * (preservando o resto do JSON). `raw` null/'' volta ao automático
   * (remove a chave). Valida estrutura e ownership.
   */
  async salvarTotais(id: string, usuarioId: string, entidadeId: string, raw: unknown) {
    const atual = await this.prisma.relatorioPersonalizado.findUnique({ where: { id } })
    if (!atual || atual.usuarioId !== usuarioId || atual.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Relatório não encontrado.')
    }
    const cfg = validarTotaisConfig(raw)
    const base = (atual.configuracao && typeof atual.configuracao === 'object' && !Array.isArray(atual.configuracao)
      ? (atual.configuracao as Record<string, unknown>)
      : {})
    const { totais: _antiga, ...resto } = base
    const configuracao = cfg ? { ...resto, totais: cfg } : resto
    return this.prisma.relatorioPersonalizado.update({ where: { id }, data: { configuracao } })
  }

  async excluir(id: string, usuarioId: string, entidadeId: string) {
    const atual = await this.prisma.relatorioPersonalizado.findUnique({ where: { id } })
    if (!atual || atual.usuarioId !== usuarioId || atual.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Relatório não encontrado.')
    }
    const favoritos = await this.prisma.favoritoRelatorio.count({ where: { relatorioPersonalizadoId: id } })
    if (favoritos > 0) {
      throw new ErroNegocio('CONFLITO', 'Há favoritos vinculados a este relatório. Remova-os antes de excluir.')
    }
    return this.prisma.relatorioPersonalizado.delete({ where: { id } })
  }

  // Cabeçalho/rodapé são opcionais; se informados, precisam ser da entidade.
  private async validarTemplates(entidadeId: string, dados: DadosRelatorio) {
    const cabecalhoId = normId(dados.cabecalhoId)
    const rodapeId = normId(dados.rodapeId)
    if (cabecalhoId) {
      const c = await this.prisma.cabecalhoRelatorio.findUnique({ where: { id: cabecalhoId } })
      if (!c || c.entidadeId !== entidadeId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'O cabeçalho escolhido não pertence a esta entidade.')
      }
    }
    if (rodapeId) {
      const r = await this.prisma.rodapeRelatorio.findUnique({ where: { id: rodapeId } })
      if (!r || r.entidadeId !== entidadeId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'O rodapé escolhido não pertence a esta entidade.')
      }
    }
    return { cabecalhoId, rodapeId }
  }
}
