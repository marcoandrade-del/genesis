import { randomUUID } from 'node:crypto'
import { PrismaClient, Prisma, type TipoEntidade, type ModoAssinatura } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

export type DadosCriarEntidade = {
  municipioId: string
  nome: string
  tipo: TipoEntidade
  ano: number
  cnpj?: string
  /** Brasão/logotipo como data URL base64 (ex.: `data:image/png;base64,...`). */
  brasao?: string | null
}

export type DadosAtualizarEntidade = {
  nome?: string
  tipo?: TipoEntidade
  cnpj?: string | null
  ativo?: boolean
  /** Brasão/logotipo como data URL base64; `null` remove o atual. */
  brasao?: string | null
  /** Como a entidade assina os documentos oficiais (manual/eletrônica). */
  assinaturaModo?: ModoAssinatura
}

type ContaModelo = {
  id: string
  codigo: string
  descricao: string
  nivel: number
  admiteMovimento: boolean
  parentId: string | null
}

/** Constrói o `createMany.data` de uma árvore de entidade a partir das contas
 * do modelo, gerando novos ids e remapeando o parentId (model → cópia). */
function copiarArvore(contas: ContaModelo[], entidadeId: string, ano: number) {
  const idNovo = new Map<string, string>(contas.map((c) => [c.id, randomUUID()]))
  return contas.map((c) => ({
    id: idNovo.get(c.id)!,
    entidadeId,
    ano,
    codigo: c.codigo,
    descricao: c.descricao,
    nivel: c.nivel,
    admiteMovimento: c.admiteMovimento,
    origem: 'MODELO' as const,
    modeloContaId: c.id,
    parentId: c.parentId ? idNovo.get(c.parentId)! : null,
  }))
}

/**
 * Entidade (prefeitura, câmara, adm. indireta) sob o Município. É a dona da
 * execução. Na criação recebe uma CÓPIA das árvores do modelo do estado
 * (contábil/receita/despesa) + fontes, para o exercício informado — esse é o
 * fluxo de onboarding que substitui o insert-por-script.
 */
export class EntidadeService {
  constructor(private prisma: PrismaClient) {}

  listar(municipioId?: string) {
    return this.prisma.entidade.findMany({
      where: municipioId ? { municipioId } : undefined,
      orderBy: { nome: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.entidade.findUnique({ where: { id } })
  }

  /** Cria a entidade e copia as árvores + fontes do modelo do estado (do ano). */
  async criar(dados: DadosCriarEntidade) {
    const municipio = await this.prisma.municipio.findUnique({
      where: { id: dados.municipioId },
      include: { estado: { select: { modeloContabilId: true } } },
    })
    if (!municipio) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Município não encontrado.')

    const modeloId = municipio.modeloContabilId ?? municipio.estado.modeloContabilId
    if (!modeloId) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'Município (e seu estado) não têm modelo contábil definido.')
    }

    const [planoCont, planoRec, planoDesp, fontes] = await Promise.all([
      this.prisma.planoDeContas.findFirst({ where: { modeloContabilId: modeloId, ano: dados.ano } }),
      this.prisma.planoContasReceita.findFirst({ where: { modeloContabilId: modeloId, ano: dados.ano } }),
      this.prisma.planoContasDespesa.findFirst({ where: { modeloContabilId: modeloId, ano: dados.ano } }),
      this.prisma.fonteRecurso.findMany({ where: { modeloContabilId: modeloId, ano: dados.ano } }),
    ])

    const [contasCont, contasRec, contasDesp] = await Promise.all([
      planoCont ? this.prisma.conta.findMany({ where: { planoId: planoCont.id }, orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
      planoRec ? this.prisma.contaReceita.findMany({ where: { planoId: planoRec.id }, orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
      planoDesp ? this.prisma.contaDespesa.findMany({ where: { planoId: planoDesp.id }, orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
    ])

    try {
      return await this.prisma.$transaction(async (tx) => {
        const entidade = await tx.entidade.create({
          data: {
            municipioId: dados.municipioId,
            nome: dados.nome,
            tipo: dados.tipo,
            ...(dados.cnpj ? { cnpj: dados.cnpj } : {}),
            ...(dados.brasao ? { brasao: dados.brasao } : {}),
          },
        })
        if (contasCont.length) await tx.contaContabilEntidade.createMany({ data: copiarArvore(contasCont, entidade.id, dados.ano) })
        if (contasRec.length) await tx.contaReceitaEntidade.createMany({ data: copiarArvore(contasRec, entidade.id, dados.ano) })
        if (contasDesp.length) await tx.contaDespesaEntidade.createMany({ data: copiarArvore(contasDesp, entidade.id, dados.ano) })
        if (fontes.length) {
          await tx.fonteRecursoEntidade.createMany({
            data: fontes.map((f) => ({
              entidadeId: entidade.id,
              ano: dados.ano,
              codigo: f.codigo,
              nomenclatura: f.nomenclatura,
              especificacao: f.especificacao,
              vinculada: f.vinculada,
              grupo: f.grupo,
              origem: 'MODELO' as const,
              modeloFonteId: f.id,
            })),
          })
        }
        return entidade
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', `Já existe uma entidade "${dados.nome}" neste município (ou CNPJ duplicado).`)
      }
      throw e
    }
  }

  async atualizar(id: string, dados: DadosAtualizarEntidade) {
    try {
      return await this.prisma.entidade.update({ where: { id }, data: dados })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') throw new ErroNegocio('CONFLITO', 'Nome ou CNPJ já em uso.')
        if (e.code === 'P2025') throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')
      }
      throw e
    }
  }

  /** Exclui a entidade e suas cópias (contas + fontes), numa transação. */
  async excluir(id: string) {
    const entidade = await this.prisma.entidade.findUnique({ where: { id } })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    await this.prisma.$transaction(async (tx) => {
      await tx.contaContabilEntidade.deleteMany({ where: { entidadeId: id } })
      await tx.contaReceitaEntidade.deleteMany({ where: { entidadeId: id } })
      await tx.contaDespesaEntidade.deleteMany({ where: { entidadeId: id } })
      await tx.fonteRecursoEntidade.deleteMany({ where: { entidadeId: id } })
      await tx.entidade.delete({ where: { id } })
    })
  }
}
