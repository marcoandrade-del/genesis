import { PrismaClient, Prisma, type StatusDemanda } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { validarAno, trimOuNull, parseDecimalPositivo, garantirCatalogoExiste } from './planos-contratacao.js'

export type DadosItemDemanda = {
  itemCatalogoId: string
  quantidade: string | number
}

export type DadosDemanda = {
  ano: number
  numero: string
  unidadeOrcamentariaId: string
  pcaId?: string | null
  justificativa: string
  itens: DadosItemDemanda[]
}

export type DadosParecer = {
  responsavel?: string | null
  observacao?: string | null
}

const TRANSICOES_VALIDAS: Record<StatusDemanda, ReadonlyArray<StatusDemanda>> = {
  RASCUNHO: ['AGUARDANDO_PARECER'],
  AGUARDANDO_PARECER: ['APROVADA', 'REPROVADA', 'RASCUNHO'],
  APROVADA: [],
  REPROVADA: ['RASCUNHO'],
}

/**
 * DOD — Documento de Oficialização da Demanda. Pedido originário do setor
 * requisitante (Unidade Orçamentária), opcionalmente vinculado ao PCA. Passa
 * por parecer jurídico (passo 4) modelado como status + campos. Conteúdo só
 * editável em RASCUNHO.
 */
export class DocumentosDemandaService {
  constructor(private prisma: PrismaClient) {}

  listar(entidadeId: string) {
    return this.prisma.documentoDemanda.findMany({
      where: { entidadeId },
      orderBy: [{ ano: 'desc' }, { numero: 'desc' }],
      include: {
        unidadeOrcamentaria: true,
        _count: { select: { itens: true } },
        termoReferencia: { select: { id: true } },
      },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.documentoDemanda.findUnique({
      where: { id },
      include: {
        entidade: true,
        unidadeOrcamentaria: true,
        pca: { select: { id: true, ano: true } },
        itens: { include: { itemCatalogo: true }, orderBy: { criadoEm: 'asc' } },
        termoReferencia: { select: { id: true } },
      },
    })
  }

  async criar(entidadeId: string, dados: DadosDemanda) {
    validarAno(dados.ano)
    const { numero, justificativa } = this.validarCampos(dados)
    await this.validarReferencias(entidadeId, dados)
    const itens = await this.validarItens(dados.itens)

    try {
      return await this.prisma.$transaction(async (tx) => {
        const dod = await tx.documentoDemanda.create({
          data: {
            entidadeId,
            ano: dados.ano,
            numero,
            unidadeOrcamentariaId: dados.unidadeOrcamentariaId,
            pcaId: trimOuNull(dados.pcaId),
            justificativa,
          },
        })
        if (itens.length > 0) {
          await tx.itemDemanda.createMany({ data: itens.map((i) => ({ documentoDemandaId: dod.id, ...i })) })
        }
        return dod
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um DOD nº "${numero}" no exercício ${dados.ano}.`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosDemanda) {
    const existente = await this.prisma.documentoDemanda.findUnique({ where: { id } })
    if (!existente) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Demanda não encontrada.')
    if (existente.status !== 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'Demanda só pode ser editada em RASCUNHO.')
    }
    validarAno(dados.ano)
    const { numero, justificativa } = this.validarCampos(dados)
    await this.validarReferencias(existente.entidadeId, dados)
    const itens = await this.validarItens(dados.itens)

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.itemDemanda.deleteMany({ where: { documentoDemandaId: id } })
        const dod = await tx.documentoDemanda.update({
          where: { id },
          data: {
            ano: dados.ano,
            numero,
            unidadeOrcamentariaId: dados.unidadeOrcamentariaId,
            pcaId: trimOuNull(dados.pcaId),
            justificativa,
          },
        })
        if (itens.length > 0) {
          await tx.itemDemanda.createMany({ data: itens.map((i) => ({ documentoDemandaId: id, ...i })) })
        }
        return dod
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe um DOD nº "${numero}" no exercício ${dados.ano}.`)
      }
      throw e
    }
  }

  async alterarStatus(id: string, novoStatus: StatusDemanda, parecer: DadosParecer = {}) {
    const dod = await this.prisma.documentoDemanda.findUnique({ where: { id } })
    if (!dod) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Demanda não encontrada.')
    if (!TRANSICOES_VALIDAS[dod.status].includes(novoStatus)) {
      throw new ErroNegocio('CONFLITO', `Transição inválida: ${dod.status} → ${novoStatus}.`)
    }

    const decidindoParecer = novoStatus === 'APROVADA' || novoStatus === 'REPROVADA'
    const responsavel = trimOuNull(parecer.responsavel)
    if (decidindoParecer && !responsavel) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Responsável pelo parecer é obrigatório.')
    }

    return this.prisma.documentoDemanda.update({
      where: { id },
      data: decidindoParecer
        ? {
            status: novoStatus,
            parecerData: new Date(),
            parecerResponsavel: responsavel,
            parecerObservacao: trimOuNull(parecer.observacao),
          }
        : { status: novoStatus },
    })
  }

  async excluir(id: string) {
    const dod = await this.prisma.documentoDemanda.findUnique({
      where: { id },
      include: { termoReferencia: { select: { id: true } } },
    })
    if (!dod) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Demanda não encontrada.')
    if (dod.status !== 'RASCUNHO') {
      throw new ErroNegocio('CONFLITO', 'Apenas demanda em rascunho pode ser excluída.')
    }
    if (dod.termoReferencia) {
      throw new ErroNegocio('CONFLITO', 'Demanda possui Termo de Referência — exclua o TR antes.')
    }
    // onDelete: Cascade remove os itens automaticamente.
    await this.prisma.documentoDemanda.delete({ where: { id } })
  }

  private validarCampos(dados: DadosDemanda) {
    const numero = dados.numero?.trim()
    const justificativa = dados.justificativa?.trim()
    if (!numero) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Número é obrigatório.')
    if (!dados.unidadeOrcamentariaId?.trim()) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Unidade orçamentária (requisitante) é obrigatória.')
    }
    if (!justificativa) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Justificativa é obrigatória.')
    return { numero, justificativa }
  }

  private async validarReferencias(entidadeId: string, dados: DadosDemanda) {
    const uo = await this.prisma.unidadeOrcamentaria.findUnique({ where: { id: dados.unidadeOrcamentariaId } })
    if (!uo || uo.entidadeId !== entidadeId) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Unidade orçamentária inválida para esta entidade.')
    }
    const pcaId = trimOuNull(dados.pcaId)
    if (pcaId) {
      const pca = await this.prisma.planoContratacaoAnual.findUnique({ where: { id: pcaId } })
      if (!pca || pca.entidadeId !== entidadeId) {
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'PCA inválido para esta entidade.')
      }
    }
  }

  private async validarItens(itens: DadosItemDemanda[]) {
    if (!Array.isArray(itens)) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Itens inválidos.')
    const normalizados = itens.map((i) => ({
      itemCatalogoId: i.itemCatalogoId,
      quantidade: parseDecimalPositivo(i.quantidade, 'Quantidade'),
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
