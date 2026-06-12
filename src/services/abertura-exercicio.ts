import type { PrismaClient } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { copiarArvore, createManyEmLotes } from './ressincronizador-modelo.js'

export type ResumoAbertura = {
  entidadeId: string
  nome: string
  ano: number
  contabil: number
  receita: number
  despesa: number
  fontes: number
}

/**
 * Abertura de exercício: copia os planos do modelo do estado (do ano alvo)
 * para uma entidade EXISTENTE — o complemento da virada de ano ao onboarding
 * (`EntidadeService.criar` só copia no momento da criação, e o
 * `RessincronizadorModelo` só refaz exercícios que a entidade já tem).
 *
 * Regras: a entidade não pode ter NENHUMA cópia do ano (senão é caso de
 * ressincronizar, não de abrir) e o modelo precisa ter ao menos um plano ou
 * fonte para o ano (senão o TCE ainda não publicou — erro claro). Atômico.
 */
export class AberturaExercicioService {
  constructor(private prisma: PrismaClient) {}

  async abrir(entidadeId: string, ano: number): Promise<ResumoAbertura> {
    if (!Number.isInteger(ano) || ano < 1900 || ano > 9999) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe um exercício (ano) válido.')
    }
    const entidade = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      include: { municipio: { include: { estado: { select: { modeloContabilId: true } } } } },
    })
    if (!entidade) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Entidade não encontrada.')

    const modeloId = entidade.municipio.modeloContabilId ?? entidade.municipio.estado.modeloContabilId
    if (!modeloId) {
      throw new ErroNegocio('ENTIDADE_NAO_PROCESSAVEL', 'Município (e seu estado) não têm modelo contábil definido.')
    }

    // Já tem qualquer cópia do ano → o exercício já está aberto.
    const filtroAno = { where: { entidadeId, ano } }
    const [temC, temR, temD, temF] = await Promise.all([
      this.prisma.contaContabilEntidade.count(filtroAno),
      this.prisma.contaReceitaEntidade.count(filtroAno),
      this.prisma.contaDespesaEntidade.count(filtroAno),
      this.prisma.fonteRecursoEntidade.count(filtroAno),
    ])
    if (temC + temR + temD + temF > 0) {
      throw new ErroNegocio('CONFLITO', `O exercício ${ano} já está aberto para esta entidade. Para atualizar as cópias, use "Ressincronizar".`)
    }

    const [planoCont, planoRec, planoDesp, fontes] = await Promise.all([
      this.prisma.planoDeContas.findFirst({ where: { modeloContabilId: modeloId, ano } }),
      this.prisma.planoContasReceita.findFirst({ where: { modeloContabilId: modeloId, ano } }),
      this.prisma.planoContasDespesa.findFirst({ where: { modeloContabilId: modeloId, ano } }),
      this.prisma.fonteRecurso.findMany({ where: { modeloContabilId: modeloId, ano } }),
    ])
    if (!planoCont && !planoRec && !planoDesp && fontes.length === 0) {
      throw new ErroNegocio(
        'ENTIDADE_NAO_PROCESSAVEL',
        `O modelo do estado ainda não tem planos para ${ano} — importe os planos do exercício no modelo antes de abrir.`,
      )
    }

    const [contasCont, contasRec, contasDesp] = await Promise.all([
      planoCont ? this.prisma.conta.findMany({ where: { planoId: planoCont.id }, orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
      planoRec ? this.prisma.contaReceita.findMany({ where: { planoId: planoRec.id }, orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
      planoDesp ? this.prisma.contaDespesa.findMany({ where: { planoId: planoDesp.id }, orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
    ])

    await this.prisma.$transaction(async (tx) => {
      if (contasCont.length) await createManyEmLotes(tx.contaContabilEntidade, copiarArvore(contasCont, entidadeId, ano))
      if (contasRec.length) await createManyEmLotes(tx.contaReceitaEntidade, copiarArvore(contasRec, entidadeId, ano))
      if (contasDesp.length) await createManyEmLotes(tx.contaDespesaEntidade, copiarArvore(contasDesp, entidadeId, ano))
      if (fontes.length) {
        await tx.fonteRecursoEntidade.createMany({
          data: fontes.map((f) => ({
            entidadeId,
            ano,
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
    }, { timeout: 120_000 })

    return {
      entidadeId,
      nome: entidade.nome,
      ano,
      contabil: contasCont.length,
      receita: contasRec.length,
      despesa: contasDesp.length,
      fontes: fontes.length,
    }
  }
}
