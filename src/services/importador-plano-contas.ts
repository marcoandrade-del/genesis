import { randomUUID } from 'node:crypto'
import {
  PrismaClient,
  Prisma,
  type NaturezaInformacao,
  type NaturezaSaldo,
  type SuperavitFinanceiro,
} from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { NIVEL_MAX } from './contas.js'

export type LinhaCSV = {
  codigo: string
  descricao: string
  codigoPai: string | null
  admiteMovimento: boolean
  // Atributos PCASP — opcionais, em código bruto da planilha TCE-PR (P/O/C, D/C/X,
  // F/P/X/O, texto). Só o plano contábil os traz; receita/despesa não.
  naturezaInformacao?: string
  naturezaSaldo?: string
  superavitFinanceiro?: string
  funcao?: string
}

const COLUNAS_OBRIGATORIAS = ['codigo', 'descricao', 'codigoPai', 'admiteMovimento'] as const
const COLUNAS_PCASP = ['naturezaInformacao', 'naturezaSaldo', 'superavitFinanceiro', 'funcao'] as const

/** Mapeia o código bruto da planilha (tpNaturezaInformacao) para o enum. */
export function mapearNaturezaInformacao(raw: string | undefined): NaturezaInformacao | null {
  switch ((raw ?? '').trim().toUpperCase()) {
    case 'P':
      return 'PATRIMONIAL'
    case 'O':
      return 'ORCAMENTARIA'
    case 'C':
      return 'CONTROLE'
    default:
      return null
  }
}

/** Mapeia tpNaturezaSaldo (D/C/X) para o enum. X = mista (admite inversão). */
export function mapearNaturezaSaldo(raw: string | undefined): NaturezaSaldo | null {
  switch ((raw ?? '').trim().toUpperCase()) {
    case 'D':
      return 'DEVEDORA'
    case 'C':
      return 'CREDORA'
    case 'X':
      return 'MISTA'
    default:
      return null
  }
}

/** Mapeia tpSuperavitFinanceiro (F/P/X/O) para o enum. */
export function mapearSuperavitFinanceiro(raw: string | undefined): SuperavitFinanceiro | null {
  switch ((raw ?? '').trim().toUpperCase()) {
    case 'F':
      return 'FINANCEIRO'
    case 'P':
      return 'PATRIMONIAL'
    case 'X':
      return 'MISTA'
    case 'O':
      return 'OUTROS_CONTROLES'
    default:
      return null
  }
}

/**
 * Importador de plano de contas via CSV.
 *
 * O CSV é validado integralmente em memória antes de qualquer escrita:
 *  - header com as 4 colunas, códigos únicos no arquivo, parents resolvíveis,
 *    sem ciclos, profundidade ≤ NIVEL_MAX, admiteMovimento apenas em folhas.
 *
 * A inserção usa `createMany` em uma só chamada: o Postgres difere a checagem
 * de FK até o fim do statement, então a auto-referência parent → filho é
 * resolvida sem nivel-por-nivel. UUIDs gerados em JS para popular `parentId`
 * sem round-trip ao banco.
 */
export class ImportadorPlanoContasService {
  constructor(private prisma: PrismaClient) {}

  async importar(planoId: string, csv: string): Promise<{ criadas: number }> {
    const plano = await this.prisma.planoDeContas.findUnique({ where: { id: planoId } })
    if (!plano) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Plano de contas não encontrado.')

    const linhas = parseCSV(csv)
    if (linhas.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'CSV não contém linhas de dados.')

    const niveis = validar(linhas)

    const idPorCodigo = new Map<string, string>(linhas.map((l) => [l.codigo, randomUUID()]))
    const dados = linhas.map((l) => ({
      id: idPorCodigo.get(l.codigo)!,
      planoId,
      codigo: l.codigo,
      descricao: l.descricao,
      nivel: niveis.get(l.codigo)!,
      admiteMovimento: l.admiteMovimento,
      parentId: l.codigoPai ? idPorCodigo.get(l.codigoPai)! : null,
      naturezaInformacao: mapearNaturezaInformacao(l.naturezaInformacao),
      naturezaSaldo: mapearNaturezaSaldo(l.naturezaSaldo),
      superavitFinanceiro: mapearSuperavitFinanceiro(l.superavitFinanceiro),
      funcao: (l.funcao ?? '').trim() || null,
    }))

    try {
      const { count } = await this.prisma.conta.createMany({ data: dados })
      return { criadas: count }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio(
          'CONFLITO',
          'Um ou mais códigos do CSV já existem no plano. Remova os duplicados ou esvazie o plano antes de importar.',
        )
      }
      throw e
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Parser (export para teste isolado dos casos de borda)
// ─────────────────────────────────────────────────────────────

export function parseCSV(texto: string): LinhaCSV[] {
  // Tira BOM UTF-8 que o Excel coloca no início do arquivo.
  const limpo = texto.replace(/^﻿/, '')
  const linhas = limpo.split(/\r?\n/).map((l) => l).filter((l) => l.trim() !== '')
  if (linhas.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'CSV vazio.')

  const header = parseCSVLine(linhas[0]!).map((c) => c.trim())
  const idx: Record<string, number> = {}
  for (const c of COLUNAS_OBRIGATORIAS) {
    const i = header.indexOf(c)
    if (i < 0) throw new ErroNegocio('REQUISICAO_INVALIDA', `Coluna obrigatória ausente: "${c}".`)
    idx[c] = i
  }
  // Colunas PCASP são opcionais: presentes só no CSV contábil enriquecido. Quando
  // ausentes, as linhas mantêm o formato de 4 campos (receita/despesa intactos).
  const idxPcasp: Record<string, number> = {}
  for (const c of COLUNAS_PCASP) {
    const i = header.indexOf(c)
    if (i >= 0) idxPcasp[c] = i
  }
  const temPcasp = Object.keys(idxPcasp).length > 0

  const result: LinhaCSV[] = []
  for (let i = 1; i < linhas.length; i++) {
    const partes = parseCSVLine(linhas[i]!)
    const numero = i + 1 // número humano (1-based, com header como linha 1)
    const codigo = (partes[idx['codigo']!] ?? '').trim()
    const descricao = (partes[idx['descricao']!] ?? '').trim()
    if (!codigo) throw new ErroNegocio('REQUISICAO_INVALIDA', `Linha ${numero}: código vazio.`)
    if (!descricao) throw new ErroNegocio('REQUISICAO_INVALIDA', `Linha ${numero}: descrição vazia.`)
    const codigoPaiRaw = (partes[idx['codigoPai']!] ?? '').trim()
    const linha: LinhaCSV = {
      codigo,
      descricao,
      codigoPai: codigoPaiRaw === '' ? null : codigoPaiRaw,
      admiteMovimento: parseBoolean(partes[idx['admiteMovimento']!]),
    }
    if (temPcasp) {
      const lerPcasp = (c: string) => {
        const j = idxPcasp[c]
        return j === undefined ? '' : (partes[j] ?? '').trim()
      }
      linha.naturezaInformacao = lerPcasp('naturezaInformacao')
      linha.naturezaSaldo = lerPcasp('naturezaSaldo')
      linha.superavitFinanceiro = lerPcasp('superavitFinanceiro')
      linha.funcao = lerPcasp('funcao')
    }
    result.push(linha)
  }
  return result
}

/** Tokeniza uma linha CSV com suporte a campos entre aspas e aspas escapadas ("" → "). */
export function parseCSVLine(linha: string): string[] {
  const out: string[] = []
  let atual = ''
  let dentroAspas = false
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]
    if (c === '"') {
      if (dentroAspas && linha[i + 1] === '"') {
        atual += '"'
        i++
      } else {
        dentroAspas = !dentroAspas
      }
    } else if (c === ',' && !dentroAspas) {
      out.push(atual)
      atual = ''
    } else {
      atual += c
    }
  }
  out.push(atual)
  return out
}

/** Aceita true/false, s/n, sim/nao, 1/0 — case-insensitive. Default: false. */
export function parseBoolean(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase()
  return s === 'true' || s === 's' || s === 'sim' || s === '1'
}

// ─────────────────────────────────────────────────────────────
// Validação em memória (sem I/O)
// ─────────────────────────────────────────────────────────────

/** Retorna o mapa código→nível. Lança ErroNegocio na primeira violação.
 * `nivelMax` permite reuso por receita/despesa (que têm tetos próprios). */
export function validar(linhas: LinhaCSV[], nivelMax: number = NIVEL_MAX): Map<string, number> {
  // 1. Códigos únicos no arquivo.
  const porCodigo = new Map<string, LinhaCSV>()
  for (const l of linhas) {
    if (porCodigo.has(l.codigo)) {
      throw new ErroNegocio('CONFLITO', `Código duplicado no CSV: "${l.codigo}".`)
    }
    porCodigo.set(l.codigo, l)
  }

  // 2. codigoPai deve referenciar código presente no arquivo.
  for (const l of linhas) {
    if (l.codigoPai && !porCodigo.has(l.codigoPai)) {
      throw new ErroNegocio(
        'REQUISICAO_INVALIDA',
        `Conta "${l.codigo}" referencia codigoPai "${l.codigoPai}" inexistente no arquivo.`,
      )
    }
  }

  // 3. Detecta ciclos + calcula níveis com DFS memoizado.
  const niveis = new Map<string, number>()
  const emProgresso = new Set<string>()
  function nivelDe(codigo: string): number {
    const cached = niveis.get(codigo)
    if (cached !== undefined) return cached
    if (emProgresso.has(codigo)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', `Ciclo na hierarquia envolvendo "${codigo}".`)
    }
    emProgresso.add(codigo)
    const linha = porCodigo.get(codigo)!
    const n = linha.codigoPai ? nivelDe(linha.codigoPai) + 1 : 1
    emProgresso.delete(codigo)
    if (n > nivelMax) {
      throw new ErroNegocio('CONFLITO', `Conta "${codigo}" excede a profundidade máxima de ${nivelMax} níveis.`)
    }
    niveis.set(codigo, n)
    return n
  }
  for (const l of linhas) nivelDe(l.codigo)

  // 4. admiteMovimento ⟹ folha (nenhuma outra linha aponta para esta como pai).
  const temFilho = new Set<string>()
  for (const l of linhas) if (l.codigoPai) temFilho.add(l.codigoPai)
  for (const l of linhas) {
    if (l.admiteMovimento && temFilho.has(l.codigo)) {
      throw new ErroNegocio('CONFLITO', `Conta "${l.codigo}" admite movimento mas tem filhos no CSV.`)
    }
  }

  return niveis
}
