/**
 * Reparo dos códigos de natureza da receita CORROMPIDOS pelo conector Elotech
 * (bug de 2026-07-21, fix no `fabricantes/elotech/codigo.ts`): o portal entrega a
 * natureza JÁ PONTUADA e o conector a fatiava como dígitos crus, gravando códigos
 * como "1...7...2..1...50..0..1" em vez de "1.7.2.1.50.0.1.00.00.00.00.00".
 *
 * Efeitos do defeito: o matching por prefixo do motor de eventos (ParametroReceita)
 * nunca casa, o rollup por natureza do balancete quebra e o cc de natureza da MSC
 * sai malformado.
 *
 * Reparo (por VALOR, determinístico — colapsa os pontos consecutivos e re-canoniza
 * com o MESMO helper do conector corrigido, então um re-sync futuro casa 1:1):
 *  1. contas: se a canônica JÁ EXISTE na entidade (o plano padrão do sincronizador
 *     convive com os desdobramentos corrompidos), MERGE — reponta as previsões
 *     para a canônica e apaga a corrompida (provado: canônicas têm 0 previsões);
 *     senão RENAME (+ `nivel` recomputado);
 *  2. `lancamento_itens.naturezaReceitaCodigo` (cc já materializado, inclusive abertura).
 *
 * Aborta (sem escrever nada) se um repoint criaria previsão duplicada
 * (orcamento+conta+fonte) — caso raro que exige merge de valores, não rename.
 *
 *   npx tsx scripts/reparar_codigos_receita_elotech.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { naturezaReceita, nivelDe, significativo } from '../src/conversor/nucleo/pcasp.js'

const APPLY = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

/** "1...7...2..1...50..0..1" → "1.7.2.1.50.0.1" → canônica de 12 grupos. */
function canonizar(corrompido: string): string {
  const colapsado = corrompido.replace(/\.{2,}/g, '.').replace(/\.+$/, '')
  return naturezaReceita(colapsado)
}

async function main() {
  console.log(`\n═══ Reparo códigos receita Elotech ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const contas = await prisma.contaReceitaEntidade.findMany({
    where: { codigo: { contains: '..' } },
    select: { id: true, codigo: true, nivel: true, entidadeId: true, ano: true, entidade: { select: { nome: true, municipio: { select: { nome: true } } } } },
  })
  if (!contas.length) { console.log('Nenhuma conta corrompida (padrão "..") — nada a reparar.'); return }

  // agrupa por entidade e checa colisões pós-reparo
  const porEntidade = new Map<string, typeof contas>()
  for (const c of contas) {
    const l = porEntidade.get(c.entidadeId) ?? []
    l.push(c)
    porEntidade.set(c.entidadeId, l)
  }
  console.log(`${contas.length} contas corrompidas em ${porEntidade.size} entidades.`)

  let conflitos = 0
  const renames: { id: string; de: string; para: string; nivel: number }[] = []
  const merges: { id: string; de: string; paraId: string; para: string }[] = []
  const deletes: { id: string; de: string }[] = []
  for (const [entidadeId, lista] of porEntidade) {
    const ano = lista[0]!.ano
    const canonicas = new Map(
      (await prisma.contaReceitaEntidade.findMany({ where: { entidadeId, ano, NOT: { codigo: { contains: '..' } } }, select: { id: true, codigo: true } })).map((c) => [c.codigo, c.id]),
    )
    const previsoesCanonicas = await prisma.previsaoReceita.count({
      where: { contaReceita: { entidadeId, ano, NOT: { codigo: { contains: '..' } } } },
    })
    if (previsoesCanonicas > 0) {
      // repoint poderia duplicar (orcamento+conta+fonte) — precisa de merge de valores
      console.log(`  ✗ entidade ${lista[0]!.entidade.municipio.nome}/${lista[0]!.entidade.nome}: ${previsoesCanonicas} previsões já nas canônicas — merge manual`)
      conflitos++
      continue
    }
    // significativo → existe nó equivalente no plano canônico? (p/ descartar nós
    // intermediários corrompidos sem recriar uma árvore paralela)
    const sigCanonicas = new Set([...canonicas.keys()].map((k) => significativo(k)))
    const prevPorConta = new Map(
      (await prisma.previsaoReceita.groupBy({ by: ['contaReceitaEntidadeId'], where: { contaReceita: { entidadeId, ano } }, _count: true })).map((g) => [g.contaReceitaEntidadeId, g._count]),
    )
    const alvosRename = new Set<string>()
    for (const c of lista) {
      const alvo = canonizar(c.codigo)
      const idCanonica = canonicas.get(alvo)
      const temPrevisao = (prevPorConta.get(c.id) ?? 0) > 0
      if (idCanonica) merges.push({ id: c.id, de: c.codigo, paraId: idCanonica, para: alvo })
      else if (!temPrevisao && sigCanonicas.has(significativo(alvo))) deletes.push({ id: c.id, de: c.codigo })
      else if (alvosRename.has(alvo)) { console.log(`  ✗ rename duplicado ${c.codigo} → ${alvo}`); conflitos++ }
      else { alvosRename.add(alvo); renames.push({ id: c.id, de: c.codigo, para: alvo, nivel: nivelDe(alvo) }) }
    }
  }
  if (conflitos) { console.log(`\nABORTADO: ${conflitos} conflito(s) — nada gravado.`); process.exitCode = 1; return }

  const municipios = [...new Set(contas.map((c) => c.entidade.municipio.nome))].sort()
  console.log(`Municípios: ${municipios.join(' · ')}`)
  console.log(`Plano: ${merges.length} merges (repoint previsões → canônica + delete) · ${renames.length} renames · ${deletes.length} nós órfãos descartados (equivalente canônico existe).`)
  console.log('Amostra:')
  for (const r of merges.slice(0, 3)) console.log(`  MERGE  ${r.de} → ${r.para}`)
  for (const r of renames.slice(0, 3)) console.log(`  RENAME ${r.de} → ${r.para} (nível ${r.nivel})`)
  for (const r of deletes.slice(0, 3)) console.log(`  DELETE ${r.de}`)

  // cc de natureza já materializado no razão (por VALOR distinto)
  const ccs: { naturezaReceitaCodigo: string }[] = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "naturezaReceitaCodigo" FROM lancamento_itens WHERE "naturezaReceitaCodigo" LIKE '%..%'`,
  )
  console.log(`${renames.length} contas a renomear · ${ccs.length} valores distintos de cc no razão a corrigir.`)

  if (!APPLY) { console.log('\nDRY-RUN: nada gravado. Rode com --apply.'); return }

  await prisma.$transaction(
    async (tx) => {
      for (const m of merges) {
        await tx.previsaoReceita.updateMany({ where: { contaReceitaEntidadeId: m.id }, data: { contaReceitaEntidadeId: m.paraId } })
        await tx.contaReceitaEntidade.delete({ where: { id: m.id } })
      }
      for (const d of deletes) await tx.contaReceitaEntidade.delete({ where: { id: d.id } })
      for (const r of renames) {
        await tx.contaReceitaEntidade.update({ where: { id: r.id }, data: { codigo: r.para, nivel: r.nivel } })
      }
      for (const c of ccs) {
        const para = canonizar(c.naturezaReceitaCodigo)
        await tx.$executeRawUnsafe(
          `UPDATE lancamento_itens SET "naturezaReceitaCodigo" = $1 WHERE "naturezaReceitaCodigo" = $2`,
          para,
          c.naturezaReceitaCodigo,
        )
      }
    },
    { timeout: 300_000 },
  )
  console.log('✓ reparo aplicado.')

  const resto = await prisma.contaReceitaEntidade.count({ where: { codigo: { contains: '..' } } })
  const restoCc: { n: bigint }[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM lancamento_itens WHERE "naturezaReceitaCodigo" LIKE '%..%'`)
  console.log(`verificação: contas corrompidas restantes = ${resto} · cc corrompidos restantes = ${restoCc[0]?.n ?? '?'} (ambos devem ser 0)`)
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
