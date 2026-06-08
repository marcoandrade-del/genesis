import { Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

/**
 * Propaga mudanças nos planos-MODELO (contábil/receita/despesa + fontes) para as
 * CÓPIAS por entidade (`origem=MODELO`), dentro da mesma transação do save.
 *
 * Regras (decisões do Marco):
 *  - Criar/editar/excluir conta-modelo → cria/atualiza/exclui a cópia em todas as
 *    entidades sob aquele modelo, no ano do plano. Só toca `origem=MODELO`;
 *    desdobramentos da entidade ficam intactos.
 *  - **Bloqueio**: editar/excluir uma conta-modelo é proibido se alguma entidade
 *    tem `DESDOBRAMENTO` abaixo da cópia correspondente (protege o trabalho local).
 *  - Entidades novas já nascem com o modelo atual (cópia no onboarding) — sem
 *    dupla aplicação. O elo é o campo fraco `modeloContaId`/`modeloFonteId`.
 *
 * Métodos recebem o `tx` da transação interativa do service-modelo.
 */

type Tx = Prisma.TransactionClient
export type TipoConta = 'CONTABIL' | 'RECEITA' | 'DESPESA'

const DELEGATE: Record<TipoConta, 'contaContabilEntidade' | 'contaReceitaEntidade' | 'contaDespesaEntidade'> = {
  CONTABIL: 'contaContabilEntidade',
  RECEITA: 'contaReceitaEntidade',
  DESPESA: 'contaDespesaEntidade',
}

// Interface mínima dos delegates de cópia que o sincronizador usa.
type DelegateEnt = {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>
  createMany(args: unknown): Promise<unknown>
  updateMany(args: unknown): Promise<unknown>
  deleteMany(args: unknown): Promise<unknown>
  count(args: unknown): Promise<number>
}
const del = (tx: Tx, tipo: TipoConta): DelegateEnt =>
  (tx as unknown as Record<string, DelegateEnt>)[DELEGATE[tipo]]!

export type ContaModeloSync = {
  id: string
  codigo: string
  descricao: string
  nivel: number
  admiteMovimento: boolean
  parentId: string | null
}
export type PlanoSync = { ano: number; modeloContabilId: string }
export type FonteModeloSync = {
  id: string
  ano: number
  codigo: string
  nomenclatura: string
  especificacao: string | null
  vinculada: boolean
  grupo: string | null
  modeloContabilId: string
}

const filtroEntidadesDoModelo = (modeloContabilId: string) => ({
  municipio: {
    OR: [{ modeloContabilId }, { modeloContabilId: null, estado: { modeloContabilId } }],
  },
})

export class SincronizadorContas {
  // ── Contas (genérico p/ os 3 planos) ─────────────────────────────────

  /** Conta criada no modelo → cria a cópia em cada entidade que tem a árvore. */
  async contaCriada(tx: Tx, tipo: TipoConta, conta: ContaModeloSync, plano: PlanoSync): Promise<void> {
    const d = del(tx, tipo)
    const linha = (entidadeId: string, ano: number, parentId: string | null) => ({
      entidadeId,
      ano,
      codigo: conta.codigo,
      descricao: conta.descricao,
      nivel: conta.nivel,
      admiteMovimento: conta.admiteMovimento,
      origem: 'MODELO' as const,
      modeloContaId: conta.id,
      parentId,
    })

    if (conta.parentId) {
      // Ancora nas cópias do pai (uma por entidade que tem a árvore).
      const pais = await d.findMany({
        where: { modeloContaId: conta.parentId, origem: 'MODELO' },
        select: { id: true, entidadeId: true, ano: true },
      })
      if (pais.length) {
        await d.createMany({
          data: pais.map((p) => linha(p['entidadeId'] as string, p['ano'] as number, p['id'] as string)),
        })
      }
      // O pai virou sintética no modelo (ganhou um filho) → reflete nas cópias.
      await d.updateMany({ where: { modeloContaId: conta.parentId, origem: 'MODELO' }, data: { admiteMovimento: false } })
    } else {
      // Conta raiz: resolve entidades sob o modelo que já têm árvore no ano.
      const ids = await this.entidadesComArvore(tx, tipo, plano)
      if (ids.length) await d.createMany({ data: ids.map((eid) => linha(eid, plano.ano, null)) })
    }
  }

  /** Pai voltou a ser analítica (perdeu o último filho) no modelo → reflete nas cópias. */
  async contaReanalitizada(tx: Tx, tipo: TipoConta, parentId: string): Promise<void> {
    await del(tx, tipo).updateMany({ where: { modeloContaId: parentId, origem: 'MODELO' }, data: { admiteMovimento: true } })
  }

  /** Conta editada no modelo → atualiza as cópias (bloqueia se houver desdobramento). */
  async contaAtualizada(tx: Tx, tipo: TipoConta, conta: ContaModeloSync): Promise<void> {
    const d = del(tx, tipo)
    await this.barrarSeDesdobrada(d, conta.id)
    await d.updateMany({
      where: { modeloContaId: conta.id, origem: 'MODELO' },
      data: { codigo: conta.codigo, descricao: conta.descricao, admiteMovimento: conta.admiteMovimento },
    })
  }

  /** Conta excluída no modelo → exclui as cópias (bloqueia se houver desdobramento). */
  async contaExcluida(tx: Tx, tipo: TipoConta, contaId: string): Promise<void> {
    const d = del(tx, tipo)
    await this.barrarSeDesdobrada(d, contaId)
    await d.deleteMany({ where: { modeloContaId: contaId, origem: 'MODELO' } })
  }

  // Bloqueia se alguma cópia desta conta-modelo tem filho DESDOBRAMENTO.
  private async barrarSeDesdobrada(d: DelegateEnt, modeloContaId: string): Promise<void> {
    const copias = await d.findMany({ where: { modeloContaId, origem: 'MODELO' }, select: { id: true } })
    if (!copias.length) return
    const desdobradas = await d.count({
      where: { parentId: { in: copias.map((c) => c['id'] as string) }, origem: 'DESDOBRAMENTO' },
    })
    if (desdobradas > 0) {
      throw new ErroNegocio(
        'CONFLITO',
        'Há desdobramento(s) em entidade(s) abaixo desta conta — remova-os antes de alterar/excluir a conta no modelo.',
      )
    }
  }

  private async entidadesComArvore(tx: Tx, tipo: TipoConta, plano: PlanoSync): Promise<string[]> {
    const ents = await tx.entidade.findMany({ where: filtroEntidadesDoModelo(plano.modeloContabilId), select: { id: true } })
    if (!ents.length) return []
    const comArvore = await del(tx, tipo).findMany({
      where: { entidadeId: { in: ents.map((e) => e.id) }, ano: plano.ano },
      distinct: ['entidadeId'],
      select: { entidadeId: true },
    })
    return comArvore.map((c) => c['entidadeId'] as string)
  }

  // ── Fontes de recurso (lista plana, sem desdobramento) ───────────────

  async fonteCriada(tx: Tx, fonte: FonteModeloSync): Promise<void> {
    const ids = await this.entidadesComArvoreContabil(tx, fonte.modeloContabilId, fonte.ano)
    if (!ids.length) return
    await tx.fonteRecursoEntidade.createMany({
      data: ids.map((entidadeId) => ({
        entidadeId,
        ano: fonte.ano,
        codigo: fonte.codigo,
        nomenclatura: fonte.nomenclatura,
        especificacao: fonte.especificacao,
        vinculada: fonte.vinculada,
        grupo: fonte.grupo,
        origem: 'MODELO' as const,
        modeloFonteId: fonte.id,
      })),
    })
  }

  async fonteAtualizada(tx: Tx, fonte: FonteModeloSync): Promise<void> {
    await tx.fonteRecursoEntidade.updateMany({
      where: { modeloFonteId: fonte.id },
      data: {
        nomenclatura: fonte.nomenclatura,
        especificacao: fonte.especificacao,
        vinculada: fonte.vinculada,
        grupo: fonte.grupo,
      },
    })
  }

  async fonteExcluida(tx: Tx, fonteId: string): Promise<void> {
    // Bloqueia se alguma cópia está em uso (dotação/previsão).
    const copias = await tx.fonteRecursoEntidade.findMany({
      where: { modeloFonteId: fonteId },
      select: { id: true, _count: { select: { dotacoes: true, previsoes: true } } },
    })
    const usada = copias.some((c) => c._count.dotacoes + c._count.previsoes > 0)
    if (usada) {
      throw new ErroNegocio(
        'CONFLITO',
        'Fonte de recurso em uso (dotação/previsão) em alguma entidade — não pode ser excluída no modelo.',
      )
    }
    await tx.fonteRecursoEntidade.deleteMany({ where: { modeloFonteId: fonteId } })
  }

  // Onboarding usa a árvore contábil como sinal — entidade onboardada no ano.
  private async entidadesComArvoreContabil(tx: Tx, modeloContabilId: string, ano: number): Promise<string[]> {
    const ents = await tx.entidade.findMany({ where: filtroEntidadesDoModelo(modeloContabilId), select: { id: true } })
    if (!ents.length) return []
    const comArvore = await tx.contaContabilEntidade.findMany({
      where: { entidadeId: { in: ents.map((e) => e.id) }, ano },
      distinct: ['entidadeId'],
      select: { entidadeId: true },
    })
    return comArvore.map((c) => c.entidadeId)
  }
}
