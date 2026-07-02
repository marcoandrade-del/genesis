/**
 * Aplica a FONTE DE RECURSO por dotação do QDD da LOA 2026 (Anexo XXIV da
 * Lei 12.100 — extraído do PDF por scripts/qdd_loa_pdf_para_csv.py) às
 * dotações da Prefeitura de Maringá, que o import do portal deixou 100% na
 * fonte sintética 9999 "Fonte não discriminada".
 *
 * Casamento por UO + função + subfunção + programa + ação + elemento
 * (mesma chave do import original). Para cada dotação:
 *   - QDD com 1 fonte  → troca fonteRecursoEntidadeId (valor confere).
 *   - QDD com N fontes → a dotação original fica com a fonte de MAIOR valor
 *     (e valorAutorizado dela) e as demais viram novas DotacaoDespesa —
 *     Σ por chave é preservada (invariante conferida antes de gravar).
 * Fontes do QDD ausentes do catálogo FonteRecursoEntidade são criadas
 * (nomenclatura do próprio QDD; vinculada=true exceto 1000; origem
 * DESDOBRAMENTO, como a 9999).
 *
 * Segurança: diferencia TUDO em memória e imprime o resumo; só escreve com
 * --apply (numa única transação). Aborta se houver dotação sem par no QDD,
 * valor divergente ou execução já lançada (empenho/reserva ≠ 0).
 *
 * Rodar: npx tsx scripts/importar_qdd_fontes_2026.ts [--apply]
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const CSV = 'data/qdd_loa_2026_maringa.csv'
const ANO = 2026
const ENTIDADE_NOME = 'Prefeitura do Município'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

type LinhaQdd = {
  uo: string
  funcao: string
  subfuncao: string
  programa: string
  acao: string
  conta: string // elemento + '.00.00' (código da ContaDespesaEntidade)
  fonte: string
  fonteNome: string
  valor: Prisma.Decimal
}

function lerCsv(): LinhaQdd[] {
  const [cabecalho, ...linhas] = readFileSync(CSV, 'utf-8').replaceAll('\r', '').trim().split('\n')
  const col = new Map(cabecalho!.split(',').map((c, i) => [c, i]))
  const idx = (c: string) => {
    const i = col.get(c)
    if (i === undefined) throw new Error(`coluna ${c} ausente no CSV`)
    return i
  }
  return linhas.map((l) => {
    // csv simples: só a última coluna (valor) nunca tem vírgula interna; os
    // nomes podem ter — o DictWriter do python os cita com aspas
    const campos: string[] = []
    let atual = ''
    let aspas = false
    for (const ch of l) {
      if (ch === '"') aspas = !aspas
      else if (ch === ',' && !aspas) {
        campos.push(atual)
        atual = ''
      } else atual += ch
    }
    campos.push(atual)
    return {
      uo: `${campos[idx('orgao')]}.${campos[idx('unidade')]}`,
      funcao: campos[idx('funcao')]!,
      subfuncao: campos[idx('subfuncao')]!,
      programa: campos[idx('programa')]!,
      acao: campos[idx('acao')]!,
      conta: `${campos[idx('natureza')]}.00.00`,
      fonte: campos[idx('fonte')]!,
      fonteNome: campos[idx('fonte_nome')]!,
      valor: new Prisma.Decimal(campos[idx('valor')]!),
    }
  })
}

const chave = (r: { uo: string; funcao: string; subfuncao: string; programa: string; acao: string; conta: string }) =>
  `${r.uo}|${r.funcao}|${r.subfuncao}|${r.programa}|${r.acao}|${r.conta}`

async function main() {
  const entidade = await prisma.entidade.findFirstOrThrow({ where: { nome: ENTIDADE_NOME } })
  const orcamento = await prisma.orcamento.findFirstOrThrow({ where: { entidadeId: entidade.id, ano: ANO } })

  // ── 1. QDD agrupado por chave de dotação ────────────────────────────────
  const qdd = new Map<string, LinhaQdd[]>()
  for (const linha of lerCsv()) {
    const grupo = qdd.get(chave(linha))
    if (grupo) grupo.push(linha)
    else qdd.set(chave(linha), [linha])
  }

  // ── 2. Dotações do banco com os códigos das dimensões ───────────────────
  const dotacoes = await prisma.dotacaoDespesa.findMany({
    where: { orcamentoId: orcamento.id },
    select: {
      id: true,
      valorAutorizado: true,
      valorReservado: true,
      valorEmpenhado: true,
      esfera: true,
      unidadeOrcamentaria: { select: { codigo: true } },
      funcao: { select: { codigo: true } },
      subfuncao: { select: { codigo: true } },
      programa: { select: { codigo: true } },
      acao: { select: { codigo: true } },
      contaDespesa: { select: { codigo: true } },
      fonteRecurso: { select: { codigo: true } },
      unidadeOrcamentariaId: true,
      funcaoId: true,
      subfuncaoId: true,
      programaId: true,
      acaoId: true,
      contaDespesaEntidadeId: true,
    },
  })

  const fontesDb = new Map(
    (
      await prisma.fonteRecursoEntidade.findMany({
        where: { entidadeId: entidade.id, ano: ANO },
        select: { id: true, codigo: true },
      })
    ).map((f) => [f.codigo, f.id])
  )

  // ── 3. Diff em memória ──────────────────────────────────────────────────
  const erros: string[] = []
  const atualizar: { id: string; fonte: string; valor?: Prisma.Decimal }[] = []
  const criar: (Omit<LinhaQdd, 'uo' | 'fonteNome'> & { base: (typeof dotacoes)[number] })[] = []
  const fontesUsadas = new Map<string, string>() // codigo → nomenclatura (p/ criar as ausentes)
  let jaComFonte = 0

  for (const d of dotacoes) {
    const k = `${d.unidadeOrcamentaria.codigo}|${d.funcao.codigo}|${d.subfuncao.codigo}|${d.programa.codigo}|${d.acao.codigo}|${d.contaDespesa.codigo}`
    const grupo = qdd.get(k)
    if (!grupo) {
      erros.push(`dotação sem par no QDD: ${k} (R$ ${d.valorAutorizado})`)
      continue
    }
    if (d.fonteRecurso.codigo !== '9999') {
      jaComFonte++ // já classificada (re-execução): não tocar
      continue
    }
    if (!new Prisma.Decimal(d.valorReservado).isZero() || !new Prisma.Decimal(d.valorEmpenhado).isZero()) {
      erros.push(`dotação com execução lançada (não desdobro): ${k}`)
      continue
    }
    const soma = grupo.reduce((s, g) => s.plus(g.valor), new Prisma.Decimal(0))
    if (!soma.equals(d.valorAutorizado)) {
      erros.push(`Σ fontes ${soma} != autorizado ${d.valorAutorizado} em ${k}`)
      continue
    }
    for (const g of grupo) fontesUsadas.set(g.fonte, g.fonteNome)
    const [maior, ...resto] = [...grupo].sort((a, b) => b.valor.comparedTo(a.valor))
    atualizar.push({ id: d.id, fonte: maior!.fonte, ...(resto.length ? { valor: maior!.valor } : {}) })
    for (const g of resto) criar.push({ ...g, base: d })
  }

  // QDD que não casou com nada (esperado: órgãos fora da entidade — Câmara 01,
  // Previdência 31, autarquias 50/60/61)
  const chavesDb = new Set(
    dotacoes.map(
      (d) =>
        `${d.unidadeOrcamentaria.codigo}|${d.funcao.codigo}|${d.subfuncao.codigo}|${d.programa.codigo}|${d.acao.codigo}|${d.contaDespesa.codigo}`
    )
  )
  const orgaosForaDb = new Map<string, number>()
  for (const [k] of qdd) {
    if (!chavesDb.has(k)) {
      const orgao = k.split('.')[0]!
      orgaosForaDb.set(orgao, (orgaosForaDb.get(orgao) ?? 0) + 1)
    }
  }

  const fontesACriar = [...fontesUsadas].filter(([codigo]) => !fontesDb.has(codigo))

  // ── 4. Resumo ───────────────────────────────────────────────────────────
  console.log(`Dotações no banco: ${dotacoes.length} (já com fonte real: ${jaComFonte})`)
  console.log(`  → trocar fonte (mantém linha): ${atualizar.length}`)
  console.log(`  → novas linhas por desdobramento multi-fonte: ${criar.length}`)
  console.log(`Fontes usadas pelo QDD: ${fontesUsadas.size} (a criar no catálogo: ${fontesACriar.length})`)
  for (const [codigo, nome] of fontesACriar) console.log(`    + ${codigo} ${nome.slice(0, 60)}`)
  console.log(
    `Chaves do QDD fora da entidade (esperado: Câmara/Previdência/autarquias): ` +
      [...orgaosForaDb].map(([o, n]) => `órgão ${o}×${n}`).join(', ')
  )
  if (erros.length) {
    console.log(`\n❌ ${erros.length} problemas — nada será gravado:`)
    for (const e of erros.slice(0, 20)) console.log('  -', e)
    process.exit(1)
  }
  if (!APPLY) {
    console.log('\nDry-run (nada gravado). Rode com --apply para aplicar.')
    return
  }

  // ── 5. Aplicar ──────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    if (fontesACriar.length) {
      await tx.fonteRecursoEntidade.createMany({
        data: fontesACriar.map(([codigo, nomenclatura]) => ({
          entidadeId: entidade.id,
          ano: ANO,
          codigo,
          nomenclatura,
          vinculada: codigo !== '1000',
          origem: 'DESDOBRAMENTO' as const,
        })),
      })
      for (const f of await tx.fonteRecursoEntidade.findMany({
        where: { entidadeId: entidade.id, ano: ANO, codigo: { in: fontesACriar.map(([c]) => c) } },
      }))
        fontesDb.set(f.codigo, f.id)
    }

    for (const a of atualizar)
      await tx.dotacaoDespesa.update({
        where: { id: a.id },
        data: { fonteRecursoEntidadeId: fontesDb.get(a.fonte)!, ...(a.valor ? { valorAutorizado: a.valor } : {}) },
      })

    if (criar.length)
      await tx.dotacaoDespesa.createMany({
        data: criar.map((c) => ({
          orcamentoId: orcamento.id,
          unidadeOrcamentariaId: c.base.unidadeOrcamentariaId,
          funcaoId: c.base.funcaoId,
          subfuncaoId: c.base.subfuncaoId,
          programaId: c.base.programaId,
          acaoId: c.base.acaoId,
          contaDespesaEntidadeId: c.base.contaDespesaEntidadeId,
          fonteRecursoEntidadeId: fontesDb.get(c.fonte)!,
          esfera: c.base.esfera,
          valorAutorizado: c.valor,
        })),
      })

    await tx.orcamento.update({
      where: { id: orcamento.id },
      data: {
        observacoes:
          ((await tx.orcamento.findUnique({ where: { id: orcamento.id } }))?.observacoes ?? '') +
          ' Fonte por dotação aplicada do QDD (Anexo XXIV da Lei 12.100) em ' +
          new Date().toISOString().slice(0, 10) +
          ' — fonte 9999 substituída pelas fontes reais; dotações multi-fonte desdobradas.',
      },
    })

    // invariante: Σ autorizado não mudou
    const soma = await tx.dotacaoDespesa.aggregate({
      where: { orcamentoId: orcamento.id },
      _sum: { valorAutorizado: true },
    })
    if (soma._sum.valorAutorizado?.toFixed(2) !== '2842650399.00')
      throw new Error(`Σ pós-import ${soma._sum.valorAutorizado} != 2.842.650.399,00 — rollback`)
    const resto9999 = await tx.dotacaoDespesa.count({
      where: { orcamentoId: orcamento.id, fonteRecurso: { codigo: '9999' } },
    })
    console.log(`\n✅ aplicado: Σ preservada (R$ ${soma._sum.valorAutorizado}), dotações na 9999: ${resto9999}`)
  })
}

main().finally(async () => {
  await prisma.$disconnect()
  await pool.end()
})
