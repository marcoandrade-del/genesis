import { PrismaClient } from '@prisma/client'
import type { LinhaDespesa } from './tipos.js'

const cent = (n: number): string => (n / 100).toFixed(2)
const tipoPrograma = (c: string) => (c === '0000' || c === '9999' ? 'OPERACOES_ESPECIAIS' : 'FINALISTICO') as const
const tipoAcao = (c: string) => (c.startsWith('1') ? 'PROJETO' : c.startsWith('2') ? 'ATIVIDADE' : 'OPERACAO_ESPECIAL') as const

/**
 * Escreve as dotações de despesa (autorizado da LOA + empenhado/liq/pago da
 * execução) de uma entidade, a partir de linhas NORMALIZADAS já reconciliadas.
 * Cria sob demanda as dimensões que faltam (UO/função/subfunção/programa/ação/
 * fonte) e, p/ o empenhado, materializa o ledger (empenho de captura CAP-* +
 * MovimentoEmpenho). Idempotente por `historico`.
 *
 * Agnóstico de fabricante — consome só `LinhaDespesa`.
 */
export async function escreverDespesa(
  prisma: PrismaClient,
  orcamentoId: string,
  entidadeId: string,
  ano: number,
  linhas: LinhaDespesa[],
  opts: { historico?: string } = {},
): Promise<{ dotacoes: number; comEmpenho: number; semConta: string[] }> {
  const historico = opts.historico ?? `CAPTURA EXECUÇÃO ${ano}`
  const funcoesDb = new Map((await prisma.funcao.findMany()).map((f) => [f.codigo, f.id]))
  const subfuncoesDb = new Map((await prisma.subfuncao.findMany()).map((s) => [s.codigo, s.id]))
  const uosDb = new Map((await prisma.unidadeOrcamentaria.findMany({ where: { entidadeId }, select: { codigo: true, id: true } })).map((u) => [u.codigo, u.id]))
  const programasDb = new Map((await prisma.programa.findMany({ where: { entidadeId, ano }, select: { codigo: true, id: true } })).map((p) => [p.codigo, p.id]))
  const acoesDb = new Map((await prisma.acao.findMany({ where: { programa: { entidadeId, ano } }, select: { codigo: true, id: true, programa: { select: { codigo: true } } } })).map((a) => [`${a.programa.codigo}|${a.codigo}`, a.id]))
  const fontesDb = new Map((await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId, ano }, select: { codigo: true, id: true } })).map((f) => [f.codigo.trim(), f.id]))
  const contasDb = new Map((await prisma.contaDespesaEntidade.findMany({ where: { entidadeId, ano }, select: { codigo: true, id: true } })).map((c) => [c.codigo, c.id]))
  const resolverConta = (nat: string): string | null => contasDb.get(nat) ?? contasDb.get(`${nat.split('.').slice(0, 4).join('.')}.00.00`) ?? null

  const uoCod = (l: LinhaDespesa) => `${l.orgao.codigo}.${l.unidade.codigo}`
  const semConta = [...new Set(linhas.filter((l) => !resolverConta(l.naturezaPcasp)).map((l) => l.naturezaPcasp))]

  // dimensões a criar
  const novas = { fu: new Map<string, string>(), su: new Map<string, string>(), uo: new Map<string, { orgaoNome: string; nome: string }>(), pr: new Map<string, string>(), ac: new Map<string, { nome: string }>(), fo: new Map<string, string>() }
  for (const l of linhas) {
    if (!funcoesDb.has(l.funcao)) novas.fu.set(l.funcao, l.funcao)
    if (!subfuncoesDb.has(l.subfuncao)) novas.su.set(l.subfuncao, l.funcao)
    if (!uosDb.has(uoCod(l))) novas.uo.set(uoCod(l), { orgaoNome: l.orgao.nome, nome: l.unidade.nome })
    if (!programasDb.has(l.programa.codigo)) novas.pr.set(l.programa.codigo, l.programa.nome ?? `Programa ${l.programa.codigo}`)
    const ka = `${l.programa.codigo}|${l.acao.codigo}`
    if (!acoesDb.has(ka)) novas.ac.set(ka, { nome: l.acao.nome ?? `Ação ${l.acao.codigo}` })
    if (!fontesDb.has(l.fonte.codigo)) novas.fo.set(l.fonte.codigo, l.fonte.descricao)
  }

  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  let fornecedor = await prisma.fornecedor.findFirst({ where: { razaoSocial: 'CAPTURA EXECUÇÃO (conversor)' }, select: { id: true } })
  fornecedor ??= await prisma.fornecedor.create({ data: { tipoPessoa: 'PJ', razaoSocial: 'CAPTURA EXECUÇÃO (conversor)', nomeFantasia: 'Execução materializada do TCE (não é credor real)' }, select: { id: true } })
  const dataMov = new Date(Date.UTC(ano, 11, 31))

  let comEmpenho = 0
  await prisma.$transaction(
    async (tx) => {
      for (const [c] of novas.fu) funcoesDb.set(c, (await tx.funcao.create({ data: { codigo: c, nome: `Função ${c}` }, select: { id: true } })).id)
      for (const [c, fn] of novas.su) subfuncoesDb.set(c, (await tx.subfuncao.create({ data: { codigo: c, nome: `Subfunção ${c}`, funcaoId: funcoesDb.get(fn)! }, select: { id: true } })).id)
      if (novas.uo.size) await tx.unidadeOrcamentaria.createMany({ data: [...novas.uo].map(([codigo, u]) => ({ entidadeId, codigo, nome: u.nome || `Unidade ${codigo}` })) })
      for (const u of await tx.unidadeOrcamentaria.findMany({ where: { entidadeId }, select: { codigo: true, id: true } })) uosDb.set(u.codigo, u.id)
      if (novas.pr.size) await tx.programa.createMany({ data: [...novas.pr].map(([codigo, nome]) => ({ entidadeId, ano, codigo, nome, tipo: tipoPrograma(codigo) })) })
      for (const p of await tx.programa.findMany({ where: { entidadeId, ano }, select: { codigo: true, id: true } })) programasDb.set(p.codigo, p.id)
      if (novas.ac.size) await tx.acao.createMany({ data: [...novas.ac].map(([ka, a]) => { const [pr, co] = ka.split('|') as [string, string]; return { programaId: programasDb.get(pr)!, codigo: co, nome: a.nome, tipo: tipoAcao(co) } }) })
      for (const a of await tx.acao.findMany({ where: { programa: { entidadeId, ano } }, select: { codigo: true, id: true, programa: { select: { codigo: true } } } })) acoesDb.set(`${a.programa.codigo}|${a.codigo}`, a.id)
      if (novas.fo.size) await tx.fonteRecursoEntidade.createMany({ data: [...novas.fo].map(([codigo, nome]) => ({ entidadeId, ano, codigo, nomenclatura: nome || `Fonte ${codigo}`, vinculada: codigo !== '01000' && codigo !== '000', origem: 'DESDOBRAMENTO' as const })) })
      for (const f of await tx.fonteRecursoEntidade.findMany({ where: { entidadeId, ano }, select: { codigo: true, id: true } })) fontesDb.set(f.codigo.trim(), f.id)

      // idempotência: limpa o ledger de captura anterior desta entidade. Apaga os
      // movimentos pelos empenhos CAP-* (marcador exclusivo da captura), NÃO pelo
      // histórico — assim é robusto mesmo se um import anterior usou outro histórico.
      await tx.movimentoEmpenho.deleteMany({ where: { empenho: { entidadeId, numero: { startsWith: 'CAP-' } } } })
      await tx.empenho.deleteMany({ where: { entidadeId, numero: { startsWith: 'CAP-' } } })

      const movRows: { entidadeId: string; empenhoId: string; tipo: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO'; valor: string; data: Date; criadoPorId: string; historico: string }[] = []
      const escritas: string[] = [] // ids das dotações escritas nesta conversão
      for (const l of linhas) {
        const contaId = resolverConta(l.naturezaPcasp)
        if (!contaId) continue
        const dotKey = {
          orcamentoId,
          unidadeOrcamentariaId: uosDb.get(uoCod(l))!,
          funcaoId: funcoesDb.get(l.funcao)!,
          subfuncaoId: subfuncoesDb.get(l.subfuncao)!,
          programaId: programasDb.get(l.programa.codigo)!,
          acaoId: acoesDb.get(`${l.programa.codigo}|${l.acao.codigo}`)!,
          contaDespesaEntidadeId: contaId,
          fonteRecursoEntidadeId: fontesDb.get(l.fonte.codigo)!,
        }
        const dot = await tx.dotacaoDespesa.upsert({
          where: { dotacao_unica: dotKey },
          create: { ...dotKey, valorAutorizado: cent(l.autorizado ?? 0), valorEmpenhado: cent(l.empenhado ?? 0) },
          update: { valorAutorizado: cent(l.autorizado ?? 0), valorEmpenhado: cent(l.empenhado ?? 0) },
          select: { id: true },
        })
        escritas.push(dot.id)
        if (l.empenhado) {
          const numero = `CAP-${dot.id.slice(0, 8)}`
          const emp = await tx.empenho.upsert({
            where: { entidadeId_numero: { entidadeId, numero } },
            create: { entidadeId, dotacaoDespesaId: dot.id, fornecedorId: fornecedor!.id, numero, tipo: 'ESTIMATIVO', data: dataMov, valor: cent(l.empenhado), valorLiquidado: cent(l.liquidado ?? 0), historico: 'Empenho de CAPTURA da execução do TCE (não é escrituração).' },
            update: { valor: cent(l.empenhado), valorLiquidado: cent(l.liquidado ?? 0) },
            select: { id: true },
          })
          movRows.push({ entidadeId, empenhoId: emp.id, tipo: 'EMPENHO', valor: cent(l.empenhado), data: dataMov, criadoPorId: usuario.id, historico })
          if (l.liquidado) movRows.push({ entidadeId, empenhoId: emp.id, tipo: 'LIQUIDACAO', valor: cent(l.liquidado), data: dataMov, criadoPorId: usuario.id, historico })
          if (l.pago) movRows.push({ entidadeId, empenhoId: emp.id, tipo: 'PAGAMENTO', valor: cent(l.pago), data: dataMov, criadoPorId: usuario.id, historico })
          comEmpenho++
        }
      }
      await tx.movimentoEmpenho.createMany({ data: movRows })

      // idempotência: remove as dotações órfãs deste orçamento (chave que sumiu numa
      // reconversão). Só as SEM dependentes bloqueantes — as CAP-* já foram apagadas
      // acima, então a dotação de conversor fica livre; qualquer dotação com empenho/
      // reserva/lançamento REAIS é preservada (não é artefato do conversor).
      if (escritas.length) {
        await tx.dotacaoDespesa.deleteMany({
          where: { orcamentoId, id: { notIn: escritas }, empenhos: { none: {} }, reservas: { none: {} }, lancamentoItens: { none: {} } },
        })
      }
    },
    { timeout: 300_000 },
  )
  return { dotacoes: linhas.length - semConta.length, comEmpenho, semConta }
}
