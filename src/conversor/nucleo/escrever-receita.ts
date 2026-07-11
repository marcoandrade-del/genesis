import { PrismaClient } from '@prisma/client'
import type { LinhaReceita } from './tipos.js'
import { ancestrais } from './pcasp.js'

const cent = (n: number): string => (n / 100).toFixed(2)

/**
 * Escreve as previsões de receita (previsto + arrecadado) de uma entidade a
 * partir de linhas NORMALIZADAS (natureza PCASP + fonte). Cria sob demanda as
 * contas de receita que faltarem (folha + ancestrais) e as fontes.
 *
 * Agnóstico de fabricante — consome só `LinhaReceita`.
 */
export async function escreverReceita(
  prisma: PrismaClient,
  orcamentoId: string,
  entidadeId: string,
  ano: number,
  linhas: LinhaReceita[],
): Promise<{ previsoes: number; contasCriadas: number; fontesCriadas: number }> {
  const contasDb = new Map(
    (await prisma.contaReceitaEntidade.findMany({ where: { entidadeId, ano }, select: { codigo: true, id: true } })).map((c) => [c.codigo, c.id]),
  )
  const fontesDb = new Map(
    (await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId, ano }, select: { codigo: true, id: true } })).map((f) => [f.codigo.trim(), f.id]),
  )

  let previsoes = 0
  let contasCriadas = 0
  let fontesCriadas = 0
  await prisma.$transaction(
    async (tx) => {
      // garante a conta (folha + ancestrais faltantes; nome de ancestral vem do paralelo cat-1/2)
      const garantirConta = async (natureza: string, descricao: string): Promise<string> => {
        const cadeia = ancestrais(natureza)
        let parentId: string | null = null
        for (let k = 0; k < cadeia.length; k++) {
          const cod = cadeia[k]!
          let id = contasDb.get(cod)
          if (!id) {
            const folha = k === cadeia.length - 1
            const paralelo = cod.replace(/^7/, '1').replace(/^8/, '2')
            const nome = folha ? descricao : (await tx.contaReceitaEntidade.findFirst({ where: { entidadeId, ano, codigo: paralelo }, select: { descricao: true } }))?.descricao ?? `Nível ${cod}`
            id = (await tx.contaReceitaEntidade.create({
              data: { entidadeId, ano, codigo: cod, descricao: nome, nivel: k + 1, admiteMovimento: false, origem: 'DESDOBRAMENTO' },
              select: { id: true },
            })).id
            contasDb.set(cod, id)
            contasCriadas++
          }
          parentId = id
        }
        return parentId!
      }
      const garantirFonte = async (codigo: string, descricao: string): Promise<string> => {
        let id = fontesDb.get(codigo.trim())
        if (!id) {
          id = (await tx.fonteRecursoEntidade.create({
            data: { entidadeId, ano, codigo, nomenclatura: descricao || `Fonte ${codigo}`, vinculada: codigo !== '0000' && codigo !== '01000', origem: 'DESDOBRAMENTO' },
            select: { id: true },
          })).id
          fontesDb.set(codigo.trim(), id)
          fontesCriadas++
        }
        return id
      }

      const escritas: string[] = []
      for (const l of linhas) {
        const contaId = await garantirConta(l.naturezaPcasp, l.redutora ? `(-) ${l.fonte.descricao || 'Dedução'}` : l.fonte.descricao || `Receita ${l.naturezaPcasp}`)
        const fonteId = await garantirFonte(l.fonte.codigo, l.fonte.descricao)
        const pv = await tx.previsaoReceita.upsert({
          where: { previsao_unica: { orcamentoId, contaReceitaEntidadeId: contaId, fonteRecursoEntidadeId: fonteId } },
          create: {
            orcamentoId,
            contaReceitaEntidadeId: contaId,
            fonteRecursoEntidadeId: fonteId,
            valorPrevisto: cent(l.previsto ?? 0),
            valorArrecadado: cent(l.arrecadado ?? 0),
          },
          update: {
            ...(l.previsto !== undefined ? { valorPrevisto: cent(l.previsto) } : {}),
            ...(l.arrecadado !== undefined ? { valorArrecadado: cent(l.arrecadado) } : {}),
          },
          select: { id: true },
        })
        escritas.push(pv.id)
        previsoes++
      }
      // idempotência: remove as previsões deste orçamento que NÃO fazem parte da
      // escrita atual — órfãs de uma conversão anterior com outro conjunto de
      // chaves (natureza/fonte que sumiu). Sem isso o total inflava no re-import.
      if (escritas.length) await tx.previsaoReceita.deleteMany({ where: { orcamentoId, id: { notIn: escritas } } })
    },
    { timeout: 120_000 },
  )
  return { previsoes, contasCriadas, fontesCriadas }
}
