import type { PrismaClient } from '@prisma/client'
import type { MunicipioConfig, TipoEntidade } from './nucleo/tipos.js'

/**
 * Config-as-data do conversor: lê/grava as configs de município (antes em .ts,
 * agora em `ConversorMunicipio`/`ConversorEntidade`) e as converte para o
 * `MunicipioConfig` que o orquestrador `importarMunicipio` consome.
 */

/** Formato do params guardado no banco (Json) — sempre chave→string. */
type Params = Record<string, string>

/** Subconjunto de uma linha do banco necessário para montar o `MunicipioConfig`. */
export type MunicipioRow = {
  nome: string
  ibge: string
  uf: string
  ano: number
  fabricante: string
  tce: string
  portalUrl: string | null
  params: unknown
  entidades: {
    nome: string
    tipo: TipoEntidade
    matchPit: string | null
    params: unknown
    ordem: number
  }[]
}

const asParams = (v: unknown): Params => (v && typeof v === 'object' ? (v as Params) : {})

/**
 * Mapeia uma linha do banco para o `MunicipioConfig`. Puro (testável sem banco).
 * Os params de escopo MUNICÍPIO são mesclados sob os de cada entidade — assim o
 * conector, que só conhece `ent.params`, enxerga o compartilhado (ex. receitaCsv)
 * junto do específico (ex. matchArquivo). A entidade sobrescreve em caso de colisão.
 */
export function paraMunicipioConfig(row: MunicipioRow): MunicipioConfig {
  const municipioParams = asParams(row.params)
  return {
    nome: row.nome,
    ibge: row.ibge,
    uf: row.uf,
    ano: row.ano,
    fabricante: row.fabricante,
    tce: row.tce,
    ...(row.portalUrl ? { portalUrl: row.portalUrl } : {}),
    entidades: [...row.entidades]
      .sort((a, b) => a.ordem - b.ordem)
      .map((e) => ({
        nome: e.nome,
        tipo: e.tipo,
        ...(e.matchPit ? { matchPit: e.matchPit } : {}),
        params: { ...municipioParams, ...asParams(e.params) },
      })),
  }
}

// ── Leitura ─────────────────────────────────────────────────────────────────

export function listarMunicipios(prisma: PrismaClient) {
  return prisma.conversorMunicipio.findMany({
    orderBy: [{ nome: 'asc' }, { ano: 'desc' }],
    include: { _count: { select: { entidades: true } } },
  })
}

export function carregarMunicipio(prisma: PrismaClient, id: string) {
  return prisma.conversorMunicipio.findUnique({
    where: { id },
    include: { entidades: { orderBy: { ordem: 'asc' } } },
  })
}

/** Config pronta para `importarMunicipio` — null se o id não existe. */
export async function carregarConfig(prisma: PrismaClient, id: string): Promise<MunicipioConfig | null> {
  const row = await carregarMunicipio(prisma, id)
  return row ? paraMunicipioConfig(row) : null
}

// ── Escrita ─────────────────────────────────────────────────────────────────

export function criarMunicipio(
  prisma: PrismaClient,
  dados: { nome: string; ibge: string; uf: string; ano: number; fabricante: string; tce: string; portalUrl?: string },
) {
  return prisma.conversorMunicipio.create({
    data: {
      nome: dados.nome,
      ibge: dados.ibge,
      uf: dados.uf.toUpperCase(),
      ano: dados.ano,
      fabricante: dados.fabricante,
      tce: dados.tce,
      portalUrl: dados.portalUrl || null,
    },
    select: { id: true },
  })
}

export async function adicionarEntidade(
  prisma: PrismaClient,
  municipioId: string,
  dados: { nome: string; tipo: TipoEntidade; matchPit?: string; params?: Params },
) {
  const ordem = await prisma.conversorEntidade.count({ where: { municipioId } })
  return prisma.conversorEntidade.create({
    data: {
      municipioId,
      nome: dados.nome,
      tipo: dados.tipo,
      matchPit: dados.matchPit || null,
      params: dados.params ?? {},
      ordem,
    },
    select: { id: true },
  })
}

export function atualizarEntidade(
  prisma: PrismaClient,
  entidadeId: string,
  dados: { nome: string; tipo: TipoEntidade; matchPit?: string },
) {
  return prisma.conversorEntidade.update({
    where: { id: entidadeId },
    data: { nome: dados.nome, tipo: dados.tipo, matchPit: dados.matchPit || null },
  })
}

export function removerEntidade(prisma: PrismaClient, entidadeId: string) {
  return prisma.conversorEntidade.delete({ where: { id: entidadeId } })
}

/** Grava/atualiza uma chave em `params` (leitura-modificação-escrita do Json). */
export async function definirParamMunicipio(prisma: PrismaClient, id: string, chave: string, valor: string) {
  const m = await prisma.conversorMunicipio.findUniqueOrThrow({ where: { id }, select: { params: true } })
  const params = { ...asParams(m.params), [chave]: valor }
  await prisma.conversorMunicipio.update({ where: { id }, data: { params } })
}

export async function definirParamEntidade(prisma: PrismaClient, entidadeId: string, chave: string, valor: string) {
  const e = await prisma.conversorEntidade.findUniqueOrThrow({ where: { id: entidadeId }, select: { params: true } })
  const params = { ...asParams(e.params), [chave]: valor }
  await prisma.conversorEntidade.update({ where: { id: entidadeId }, data: { params } })
}
