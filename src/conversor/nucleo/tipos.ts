/**
 * Contratos do CONVERSOR de dados de municípios.
 *
 * Ideia central (direção do Marco): organizar por FABRICANTE do software de
 * gestão (Elotech/IPM/Betha/...), não por município — cada fabricante tem
 * centenas de clientes. Dois eixos independentes:
 *   1. FABRICANTE  → fonte do ORÇAMENTÁRIO (previsão, dotação, arrecadação).
 *   2. TCE do ESTADO → fonte da EXECUÇÃO (empenho), agnóstico de fabricante.
 *
 * O que faz tudo reusar: cada conector NORMALIZA os códigos crus dele para o
 * padrão PCASP nacional. Depois disso, o núcleo (onboarding/writers/
 * reconciliação) não sabe nem se importa de qual fabricante veio.
 *
 * Valores monetários SEMPRE em CENTAVOS (inteiro) para não acumular erro de float.
 */

import type { PrismaClient } from '@prisma/client'

export type TipoEntidade = 'PREFEITURA' | 'CAMARA' | 'ADM_INDIRETA'

/**
 * Fonte de recurso como o FABRICANTE (ou o TCE) a codifica. O código numérico
 * diverge entre fabricante e TCE para a MESMA fonte, então a reconciliação é
 * feita por DESCRIÇÃO (normalizada) — ver `casarFontesPorDescricao`.
 */
export type FonteNorm = { codigo: string; descricao: string }

/** Linha de RECEITA normalizada para o padrão PCASP. */
export type LinhaReceita = {
  /** natureza da receita PCASP pontuada, ex. "1.1.1.0.00.0.0.00.00.00.00.00". */
  naturezaPcasp: string
  fonte: FonteNorm
  /** previsto/arrecadado em centavos (arrecadado negativo em linhas redutoras). */
  previsto?: number
  arrecadado?: number
  /** dedução (FUNDEB etc.) — recebe tratamento de conta redutora. */
  redutora?: boolean
}

/** Linha de DESPESA normalizada (dotação e/ou execução) em PCASP. */
export type LinhaDespesa = {
  orgao: { codigo: string; nome: string }
  unidade: { codigo: string; nome: string }
  funcao: string // 2 dígitos
  subfuncao: string // 3 dígitos
  programa: { codigo: string; nome?: string }
  acao: { codigo: string; nome?: string }
  /** natureza da despesa PCASP no nível ELEMENTO, ex. "3.1.90.11.00.00". */
  naturezaPcasp: string
  fonte: FonteNorm
  /** valores em centavos. */
  autorizado?: number
  empenhado?: number
  liquidado?: number
  pago?: number
}

/** Config de UMA entidade do município — como localizá-la em cada fonte. */
export type EntidadeConfig = {
  /** nome no Gênesis (usado no onboarding e nos lookups). */
  nome: string
  tipo: TipoEntidade
  /** substring que casa `nmEntidade` no PIT (ex. "MUNICÍPIO", "CENTRAL"). */
  matchPit?: string
  /** poder_orgao que isola esta entidade na MSC do SICONFI (ex. "10131" executivo, "20231" legislativo); ausente = ente consolidado. */
  matchSiconfi?: string
  /** parâmetros específicos do conector do fabricante (ex. caminho do CSV desta entidade). */
  params?: Record<string, string>
}

/** Config de um MUNICÍPIO a converter — só dados, sem lógica. */
export type MunicipioConfig = {
  nome: string // "Paranaguá"
  ibge: string // "411820"
  uf: string // "PR"
  ano: number
  fabricante: string // "ipm" | "elotech" | ...
  tce: string // "pr" | "siconfi" | "portal" — fonte da execução
  portalUrl?: string
  /** Pula a fase-2 de créditos (decretos) mesmo que o conector a suporte. */
  pularCreditos?: boolean
  entidades: EntidadeConfig[]
}

/**
 * Conector de um FABRICANTE de software de gestão pública. Lê o ORÇAMENTÁRIO e
 * devolve linhas já NORMALIZADAS em PCASP. Uma implementação por fabricante
 * concentra "onde buscar" e "como decodificar" — o resto do sistema não repete.
 */
export interface ConectorFabricante {
  nome: string
  /** Previsão da receita (+ arrecadação, se a fonte trouxer) de uma entidade. */
  lerReceita(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaReceita[]>
  /** Dotação inicial (orçado) da despesa de uma entidade. */
  lerDespesa(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaDespesa[]>
  /**
   * FASE 2 (opcional): aplica os créditos adicionais (decretos) do portal sobre o
   * autorizado da entidade — só fabricantes com API de decretos implementam (ex.:
   * Elotech). A LOA (fase 1) já precisa estar gravada. Idempotente por nº de decreto.
   */
  sincronizarCreditos?(prisma: PrismaClient, cfg: MunicipioConfig, ent: EntidadeConfig, entidadeId: string): Promise<ResultadoCreditos>
}

/** Resultado da fase-2 de créditos (decretos). */
export type ResultadoCreditos = { status: 'OK' | 'DIVERGENTE' | 'ERRO'; mensagem: string; valorGravado: number }

/**
 * Fonte da EXECUÇÃO da despesa — o TCE do estado (dados abertos). Agnóstico de
 * fabricante (o PIT do TCE-PR cobre todos os municípios do Paraná).
 */
export interface FonteExecucao {
  nome: string
  /** Empenhado/liquidado/pago por dotação (natureza no elemento) de uma entidade. */
  lerExecucao(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaDespesa[]>
}
