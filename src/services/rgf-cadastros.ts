import { PrismaClient, type CategoriaDivida, type TipoGarantia, type TipoOperacaoCredito } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

/**
 * Cadastros de apoio do RGF (MDF 9ª ed.) — os dados que não nascem da execução
 * orçamentária: estoque da Dívida Consolidada (Anexo 2), garantias concedidas
 * (Anexo 3) e operações de crédito (Anexo 4). Um service só, CRUD enxuto por
 * entidade/exercício + totalizadores que os demonstrativos consomem.
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v)
  if (!Number.isFinite(n) || n < 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor inválido — informe um número não-negativo.')
  return Math.round(n * 100) / 100
}
const texto = (v: unknown, campo: string): string => {
  const s = String(v ?? '').trim()
  if (!s) throw new ErroNegocio('REQUISICAO_INVALIDA', `Informe ${campo}.`)
  return s
}

export const CATEGORIAS_DIVIDA: { valor: CategoriaDivida; rotulo: string }[] = [
  { valor: 'MOBILIARIA', rotulo: 'Dívida mobiliária' },
  { valor: 'CONTRATUAL', rotulo: 'Dívida contratual' },
  { valor: 'PRECATORIOS', rotulo: 'Precatórios (posteriores a 5/5/2000)' },
  { valor: 'DEMAIS', rotulo: 'Demais dívidas' },
]

export const TIPOS_GARANTIA: { valor: TipoGarantia; rotulo: string }[] = [
  { valor: 'INTERNA', rotulo: 'Interna' },
  { valor: 'EXTERNA', rotulo: 'Externa' },
]

export const TIPOS_OPERACAO_CREDITO: { valor: TipoOperacaoCredito; rotulo: string; sujeitaLimite: boolean }[] = [
  { valor: 'MOBILIARIA', rotulo: 'Mobiliária', sujeitaLimite: true },
  { valor: 'CONTRATUAL_INTERNA', rotulo: 'Contratual interna', sujeitaLimite: true },
  { valor: 'CONTRATUAL_EXTERNA', rotulo: 'Contratual externa', sujeitaLimite: true },
  { valor: 'ARO', rotulo: 'Antecipação de Receita Orçamentária (ARO)', sujeitaLimite: false },
  { valor: 'REESTRUTURACAO', rotulo: 'Reestruturação da dívida', sujeitaLimite: false },
  { valor: 'DEMAIS_NAO_SUJEITAS', rotulo: 'Demais (não sujeitas ao limite)', sujeitaLimite: false },
]

const cat = (v: unknown): CategoriaDivida => {
  const ok = CATEGORIAS_DIVIDA.find((c) => c.valor === v)
  if (!ok) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Categoria de dívida inválida.')
  return ok.valor
}
const tipoGar = (v: unknown): TipoGarantia => {
  const ok = TIPOS_GARANTIA.find((t) => t.valor === v)
  if (!ok) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo de garantia inválido.')
  return ok.valor
}
const tipoOp = (v: unknown): TipoOperacaoCredito => {
  const ok = TIPOS_OPERACAO_CREDITO.find((t) => t.valor === v)
  if (!ok) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Tipo de operação de crédito inválido.')
  return ok.valor
}

export interface TotaisRgf {
  divida: { porCategoria: { categoria: CategoriaDivida; rotulo: string; total: number }[]; total: number }
  garantias: { porTipo: { tipo: TipoGarantia; rotulo: string; total: number; contragarantias: number }[]; total: number; contragarantias: number }
  operacoes: { sujeitas: number; aro: number; naoSujeitas: number; total: number }
}

export class RgfCadastrosService {
  constructor(private prisma: PrismaClient) {}

  // ── Dívida Consolidada (Anexo 2) ──────────────────────────────────────────
  listarDivida(entidadeId: string, ano: number) {
    return this.prisma.dividaItem.findMany({ where: { entidadeId, ano }, orderBy: [{ categoria: 'asc' }, { criadoEm: 'asc' }] })
  }

  async criarDivida(entidadeId: string, ano: number, dados: { categoria?: unknown; descricao?: unknown; valorSaldo?: unknown }) {
    return this.prisma.dividaItem.create({
      data: { entidadeId, ano, categoria: cat(dados.categoria), descricao: texto(dados.descricao, 'a descrição'), valorSaldo: num(dados.valorSaldo) },
    })
  }

  async excluirDivida(entidadeId: string, id: string) {
    const item = await this.prisma.dividaItem.findUnique({ where: { id }, select: { entidadeId: true } })
    if (!item || item.entidadeId !== entidadeId) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Item da dívida não encontrado nesta entidade.')
    return this.prisma.dividaItem.delete({ where: { id } })
  }

  // ── Garantias (Anexo 3) ───────────────────────────────────────────────────
  listarGarantias(entidadeId: string, ano: number) {
    return this.prisma.garantia.findMany({ where: { entidadeId, ano }, orderBy: [{ tipo: 'asc' }, { criadoEm: 'asc' }] })
  }

  async criarGarantia(entidadeId: string, ano: number, dados: { tipo?: unknown; beneficiario?: unknown; valor?: unknown; contragarantia?: unknown }) {
    const contragarantia = dados.contragarantia == null || dados.contragarantia === '' ? 0 : num(dados.contragarantia)
    return this.prisma.garantia.create({
      data: { entidadeId, ano, tipo: tipoGar(dados.tipo), beneficiario: texto(dados.beneficiario, 'o beneficiário'), valor: num(dados.valor), contragarantia },
    })
  }

  async excluirGarantia(entidadeId: string, id: string) {
    const g = await this.prisma.garantia.findUnique({ where: { id }, select: { entidadeId: true } })
    if (!g || g.entidadeId !== entidadeId) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Garantia não encontrada nesta entidade.')
    return this.prisma.garantia.delete({ where: { id } })
  }

  // ── Operações de crédito (Anexo 4) ────────────────────────────────────────
  listarOperacoes(entidadeId: string, ano: number) {
    return this.prisma.operacaoCredito.findMany({ where: { entidadeId, ano }, orderBy: [{ data: 'asc' }] })
  }

  async criarOperacao(entidadeId: string, ano: number, dados: { tipo?: unknown; credor?: unknown; valor?: unknown; data?: unknown }) {
    const data = new Date(String(dados.data ?? ''))
    if (Number.isNaN(data.getTime())) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Data da operação inválida.')
    return this.prisma.operacaoCredito.create({
      data: { entidadeId, ano, tipo: tipoOp(dados.tipo), credor: texto(dados.credor, 'o credor'), valor: num(dados.valor), data },
    })
  }

  async excluirOperacao(entidadeId: string, id: string) {
    const o = await this.prisma.operacaoCredito.findUnique({ where: { id }, select: { entidadeId: true } })
    if (!o || o.entidadeId !== entidadeId) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Operação de crédito não encontrada nesta entidade.')
    return this.prisma.operacaoCredito.delete({ where: { id } })
  }

  // ── Totalizadores para os demonstrativos ──────────────────────────────────
  async totais(entidadeId: string, ano: number, fimPeriodo?: Date): Promise<TotaisRgf> {
    const [divida, garantias, operacoes] = await Promise.all([
      this.listarDivida(entidadeId, ano),
      this.listarGarantias(entidadeId, ano),
      this.prisma.operacaoCredito.findMany({
        where: { entidadeId, ano, ...(fimPeriodo ? { data: { lte: fimPeriodo } } : {}) },
        select: { tipo: true, valor: true },
      }),
    ])
    const r2 = (n: number) => Math.round(n * 100) / 100
    const porCategoria = CATEGORIAS_DIVIDA.map((c) => ({
      categoria: c.valor,
      rotulo: c.rotulo,
      total: r2(divida.filter((d) => d.categoria === c.valor).reduce((a, d) => a + Number(d.valorSaldo), 0)),
    }))
    const porTipo = TIPOS_GARANTIA.map((t) => {
      const doTipo = garantias.filter((g) => g.tipo === t.valor)
      return {
        tipo: t.valor,
        rotulo: t.rotulo,
        total: r2(doTipo.reduce((a, g) => a + Number(g.valor), 0)),
        contragarantias: r2(doTipo.reduce((a, g) => a + Number(g.contragarantia), 0)),
      }
    })
    const sujeitasTipos = new Set(TIPOS_OPERACAO_CREDITO.filter((t) => t.sujeitaLimite).map((t) => t.valor))
    const soma = (fn: (tipo: TipoOperacaoCredito) => boolean) =>
      r2(operacoes.filter((o) => fn(o.tipo)).reduce((a, o) => a + Number(o.valor), 0))
    const sujeitas = soma((t) => sujeitasTipos.has(t))
    const aro = soma((t) => t === 'ARO')
    const naoSujeitas = soma((t) => !sujeitasTipos.has(t) && t !== 'ARO')
    return {
      divida: { porCategoria, total: r2(porCategoria.reduce((a, c) => a + c.total, 0)) },
      garantias: {
        porTipo,
        total: r2(porTipo.reduce((a, t) => a + t.total, 0)),
        contragarantias: r2(porTipo.reduce((a, t) => a + t.contragarantias, 0)),
      },
      operacoes: { sujeitas, aro, naoSujeitas, total: r2(sujeitas + aro + naoSujeitas) },
    }
  }
}
