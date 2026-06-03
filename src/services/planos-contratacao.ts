import { PrismaClient, Prisma, type StatusPca } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosItemPca = {
  itemCatalogoId: string
  quantidadeEstimada: string | number
  valorUnitarioEstimado: string | number
}

export type DadosPca = {
  observacoes?: string | null
  itens: DadosItemPca[]
}

const TRANSICOES_VALIDAS: Record<StatusPca, ReadonlyArray<StatusPca>> = {
  RASCUNHO: ['APROVADO'],
  APROVADO: ['RASCUNHO'],
}

/**
 * PCA — Plano de Contratações Anual, por entidade × ano. Consolida o que a
 * entidade pretende contratar no exercício. Itens são substituídos
 * integralmente a cada salvamento (mesmo padrão da Tabela de Eventos).
 * Conteúdo só editável em RASCUNHO.
 */
export class PlanosContratacaoService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.planoContratacaoAnual.findMany({
      where: { entidadeId },
      orderBy: { ano: 'desc' },
      include: { _count: { select: { itens: true, demandas: true } } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.planoContratacaoAnual.findUnique({
      where: { id },
      include: {
        entidade: true,
        itens: { include: { itemCatalogo: true }, orderBy: { criadoEm: 'asc' } },
      },
    })
  }

  async criar(entidadeId: string, ano: number, dados: DadosPca) {
    validarAno(ano)
    const entidade = await this.prisma.entidade.findUnique({ where: { id: entidadeId } })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')
    const itens = await this.validarItens(dados.itens)

    try {
      return await this.prisma.$transaction(async (tx) => {
        const pca = await tx.planoContratacaoAnual.create({
          data: { entidadeId, ano, observacoes: trimOuNull(dados.observacoes) },
        })
        if (itens.length > 0) {
          await tx.itemPca.createMany({ data: itens.map((i) => ({ pcaId: pca.id, ...i })) })
        }
        return pca
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um PCA para esta entidade no exercício ${ano}.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosPca) {
    const pca = await this.carregarEditavel(id)
    const itens = await this.validarItens(dados.itens)

    return this.prisma.$transaction(async (tx) => {
      await tx.itemPca.deleteMany({ where: { pcaId: pca.id } })
      const atualizado = await tx.planoContratacaoAnual.update({
        where: { id },
        data: { observacoes: trimOuNull(dados.observacoes) },
      })
      if (itens.length > 0) {
        await tx.itemPca.createMany({ data: itens.map((i) => ({ pcaId: id, ...i })) })
      }
      return atualizado
    })
  }

  async alterarStatus(id: string, novoStatus: StatusPca) {
    const pca = await this.prisma.planoContratacaoAnual.findUnique({ where: { id } })
    if (!pca) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'PCA não encontrado.')
    if (!TRANSICOES_VALIDAS[pca.status].includes(novoStatus)) {
      throw new ErroNegocio('CONFLITO', `Transição inválida: ${pca.status} → ${novoStatus}.`)
    }
    return this.prisma.planoContratacaoAnual.update({ where: { id }, data: { status: novoStatus } })
  }

  async excluir(id: string) {
    const pca = await this.prisma.planoContratacaoAnual.findUnique({
      where: { id },
      include: { _count: { select: { demandas: true } } },
    })
    if (!pca) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'PCA não encontrado.')
    if (pca.status !== 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'Apenas PCA em rascunho pode ser excluído.')
    }
    if (pca._count.demandas > 0) {
      throw new ErroNegocio('CONFLITO', `Não é possível excluir: PCA tem ${pca._count.demandas} demanda(s) vinculada(s).`)
    }
    // onDelete: Cascade remove os itens automaticamente.
    await this.prisma.planoContratacaoAnual.delete({ where: { id } })
  }

  private async carregarEditavel(id: string) {
    const pca = await this.prisma.planoContratacaoAnual.findUnique({ where: { id } })
    if (!pca) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'PCA não encontrado.')
    if (pca.status !== 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'PCA só pode ser editado em RASCUNHO.')
    }
    return pca
  }

  /** Valida e normaliza os itens; confere existência no catálogo e duplicidade. */
  private async validarItens(itens: DadosItemPca[]) {
    if (!Array.isArray(itens)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Itens inválidos.')
    }
    const normalizados = itens.map((i) => ({
      itemCatalogoId: i.itemCatalogoId,
      quantidadeEstimada: parseDecimalPositivo(i.quantidadeEstimada, 'Quantidade estimada'),
      valorUnitarioEstimado: parseDecimalNaoNegativo(i.valorUnitarioEstimado, 'Valor unitário estimado'),
    }))
    for (const i of normalizados) {
      if (!i.itemCatalogoId?.trim()) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Item do catálogo é obrigatório.')
      }
    }
    await garantirCatalogoExiste(this.prisma, normalizados.map((i) => i.itemCatalogoId))
    return normalizados
  }
}

// ─── Helpers compartilhados do módulo de compras ──────────────────────────────

export function validarAno(ano: number) {
  if (!Number.isInteger(ano) || ano < 1900 || ano > 9999) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', 'Ano inválido.')
  }
}

export function trimOuNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}

export function parseDecimalPositivo(v: string | number, rotulo: string): Prisma.Decimal {
  const d = parseDecimalNaoNegativo(v, rotulo)
  if (d.isZero()) throw new ErroNegocio('REQUISICAO_INVALIDA', `${rotulo} deve ser maior que zero.`)
  return d
}

export function parseDecimalNaoNegativo(v: string | number, rotulo: string): Prisma.Decimal {
  if (v === null || v === undefined || v === '') {
    throw new ErroNegocio('REQUISICAO_INVALIDA', `${rotulo} é obrigatório.`)
  }
  let d: Prisma.Decimal
  try {
    d = new Prisma.Decimal(v as Prisma.Decimal.Value)
  } catch {
    throw new ErroNegocio('REQUISICAO_INVALIDA', `${rotulo} inválido: "${v}".`)
  }
  if (d.isNegative()) throw new ErroNegocio('REQUISICAO_INVALIDA', `${rotulo} não pode ser negativo.`)
  return d
}

/** Confere (sem N+1) que todos os ids existem no catálogo e não há duplicados. */
export async function garantirCatalogoExiste(prisma: PrismaClient, ids: string[]) {
  const unicos = new Set(ids)
  if (unicos.size !== ids.length) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', 'Item do catálogo repetido na lista.')
  }
  if (unicos.size === 0) return
  const achados = await prisma.itemCatalogo.findMany({
    where: { id: { in: [...unicos] } },
    select: { id: true },
  })
  if (achados.length !== unicos.size) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', 'Um ou mais itens do catálogo não existem.')
  }
}
