import { PrismaClient } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

// Elementos que cada faixa aceita. O editor WYSIWYG só oferece estes; o service
// revalida no servidor (defesa contra payload forjado). A ordem aqui é a ordem
// em que aparecem na paleta.
export const ELEMENTOS_CABECALHO = [
  'BRASAO',
  'NOME_ENTIDADE',
  'NOME_RELATORIO',
  'DATA_GERACAO',
  'HORA_GERACAO',
  'NUMERO_PAGINA',
] as const

export const ELEMENTOS_RODAPE = [
  'ENDERECO_ENTIDADE',
  'DATA_GERACAO',
  'HORA_GERACAO',
  'NUMERO_PAGINA',
] as const

// Rótulos legíveis (usados na paleta e no preview do editor).
export const ROTULOS_ELEMENTO: Record<string, string> = {
  BRASAO: 'Brasão da entidade',
  NOME_ENTIDADE: 'Nome da entidade',
  NOME_RELATORIO: 'Nome do relatório',
  DATA_GERACAO: 'Data da geração',
  HORA_GERACAO: 'Horário da geração',
  NUMERO_PAGINA: 'Número da página',
  ENDERECO_ENTIDADE: 'Endereço da entidade',
}

export type ElementoLayout = { tipo: string; x: number; y: number }

type DadosTemplate = { nome?: unknown; altura?: unknown; layout?: unknown }

const ALTURA_MIN = 40
const ALTURA_MAX = 400
const ALTURA_PADRAO_CABECALHO = 120
const ALTURA_PADRAO_RODAPE = 80
const NOME_MAX = 120

function normalizarNome(nome: unknown): string {
  const v = typeof nome === 'string' ? nome.trim() : ''
  if (!v) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe o nome do template.')
  if (v.length > NOME_MAX) throw new ErroNegocio('REQUISICAO_INVALIDA', `Nome muito longo (máx. ${NOME_MAX}).`)
  return v
}

function normalizarAltura(altura: unknown, padrao: number): number {
  if (altura === undefined || altura === null || altura === '') return padrao
  const n = typeof altura === 'number' ? altura : Number(altura)
  if (!Number.isFinite(n) || n < ALTURA_MIN || n > ALTURA_MAX) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', `Altura deve estar entre ${ALTURA_MIN} e ${ALTURA_MAX} px.`)
  }
  return Math.round(n)
}

// Limita a posição à área da faixa (0–100% com 2 casas).
function clampPct(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100))
}

/**
 * Valida e normaliza a lista de elementos do layout. Cada `tipo` deve estar na
 * allowlist da faixa e aparecer no máximo uma vez; x/y são porcentagens.
 */
function validarLayout(permitidos: readonly string[], layout: unknown): ElementoLayout[] {
  if (!Array.isArray(layout)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Layout inválido.')
  const vistos = new Set<string>()
  return layout.map((el) => {
    if (typeof el !== 'object' || el === null) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Elemento de layout inválido.')
    }
    const { tipo, x, y } = el as Record<string, unknown>
    if (typeof tipo !== 'string' || !permitidos.includes(tipo)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', `Elemento não permitido nesta faixa: ${String(tipo)}.`)
    }
    if (vistos.has(tipo)) throw new ErroNegocio('REQUISICAO_INVALIDA', `Elemento duplicado: ${tipo}.`)
    vistos.add(tipo)
    const nx = typeof x === 'number' ? x : Number(x)
    const ny = typeof y === 'number' ? y : Number(y)
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Posição de elemento inválida.')
    }
    return { tipo, x: clampPct(nx), y: clampPct(ny) }
  })
}

/**
 * CRUD dos templates de cabeçalho e rodapé de relatório. Tudo escopado por
 * entidade (contexto do operador no /app): as buscas filtram por `entidadeId`
 * e as mutações exigem que o registro pertença à entidade do contexto.
 */
export class CabecalhosRodapesService {
  constructor(private prisma: PrismaClient) {}

  private async garantirEntidade(entidadeId: string) {
    const ent = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!ent) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')
    return ent
  }

  // ── Cabeçalhos ────────────────────────────────────────────────

  listarCabecalhos(entidadeId: string) {
    return this.prisma.cabecalhoRelatorio.findMany({ where: { entidadeId }, orderBy: { nome: 'asc' } })
  }

  buscarCabecalho(id: string) {
    return this.prisma.cabecalhoRelatorio.findUnique({ where: { id } })
  }

  async criarCabecalho(entidadeId: string, criadoPorId: string, dados: DadosTemplate) {
    await this.garantirEntidade(entidadeId)
    const nome = normalizarNome(dados.nome)
    const altura = normalizarAltura(dados.altura, ALTURA_PADRAO_CABECALHO)
    const layout = validarLayout(ELEMENTOS_CABECALHO, dados.layout)
    return this.prisma.cabecalhoRelatorio.create({ data: { entidadeId, criadoPorId, nome, altura, layout } })
  }

  async atualizarCabecalho(id: string, entidadeId: string, dados: DadosTemplate) {
    const atual = await this.prisma.cabecalhoRelatorio.findUnique({ where: { id } })
    if (!atual || atual.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Cabeçalho não encontrado.')
    }
    const nome = normalizarNome(dados.nome)
    const altura = normalizarAltura(dados.altura, atual.altura)
    const layout = validarLayout(ELEMENTOS_CABECALHO, dados.layout)
    return this.prisma.cabecalhoRelatorio.update({ where: { id }, data: { nome, altura, layout } })
  }

  async excluirCabecalho(id: string, entidadeId: string) {
    const atual = await this.prisma.cabecalhoRelatorio.findUnique({ where: { id } })
    if (!atual || atual.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Cabeçalho não encontrado.')
    }
    return this.prisma.cabecalhoRelatorio.delete({ where: { id } })
  }

  // ── Rodapés ───────────────────────────────────────────────────

  listarRodapes(entidadeId: string) {
    return this.prisma.rodapeRelatorio.findMany({ where: { entidadeId }, orderBy: { nome: 'asc' } })
  }

  buscarRodape(id: string) {
    return this.prisma.rodapeRelatorio.findUnique({ where: { id } })
  }

  async criarRodape(entidadeId: string, criadoPorId: string, dados: DadosTemplate) {
    await this.garantirEntidade(entidadeId)
    const nome = normalizarNome(dados.nome)
    const altura = normalizarAltura(dados.altura, ALTURA_PADRAO_RODAPE)
    const layout = validarLayout(ELEMENTOS_RODAPE, dados.layout)
    return this.prisma.rodapeRelatorio.create({ data: { entidadeId, criadoPorId, nome, altura, layout } })
  }

  async atualizarRodape(id: string, entidadeId: string, dados: DadosTemplate) {
    const atual = await this.prisma.rodapeRelatorio.findUnique({ where: { id } })
    if (!atual || atual.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Rodapé não encontrado.')
    }
    const nome = normalizarNome(dados.nome)
    const altura = normalizarAltura(dados.altura, atual.altura)
    const layout = validarLayout(ELEMENTOS_RODAPE, dados.layout)
    return this.prisma.rodapeRelatorio.update({ where: { id }, data: { nome, altura, layout } })
  }

  async excluirRodape(id: string, entidadeId: string) {
    const atual = await this.prisma.rodapeRelatorio.findUnique({ where: { id } })
    if (!atual || atual.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Rodapé não encontrado.')
    }
    return this.prisma.rodapeRelatorio.delete({ where: { id } })
  }
}
