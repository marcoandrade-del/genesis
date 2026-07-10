/**
 * Importa a PREVISÃO DA RECEITA (LOA 2026) de Paranaguá a partir do CSV exportado
 * do portal IPM (atende.net → Dados Abertos → "Orçamento da Receita").
 *
 * O CSV traz a receita orçada por NATUREZA (nível espécie), de 3 entidades:
 * Prefeitura, Previdência e Fundação de Assistência à Saúde. NÃO traz fonte de
 * recurso (a coluna "Fonte" é uma escada de valor por nível) → usamos uma fonte
 * placeholder por entidade. Deduções (FUNDEB, código "9…") ficam sinalizadas.
 *
 * Código do CSV (19 díg, ex "4111000000000000000") → conta do banco: dropar o
 * 1º díg e fatiar [1,1,1,1,2,1,1,2,2,2,2,2] → "1.1.1.0.00.0.0.00.00.00.00.00".
 *
 * DRY-RUN por padrão; --apply grava. Rodar (da raiz):
 *   npx tsx scripts/importar_receita_loa_paranagua_ipm.ts [--csv <arq>] [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type TipoEntidade } from '@prisma/client'
import { EntidadeService } from '../src/services/entidades.js'

const ANO = 2026
const CSV = (() => {
  const i = process.argv.indexOf('--csv')
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : '/home/marco/Downloads/Relatorio.csv'
})()
const APPLY = process.argv.includes('--apply')
const FONTE_PLACEHOLDER = '0000' // export IPM não detalha fonte da receita

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const cent = (s: string): number => Math.round(parseFloat((s || '0').trim() || '0') * 100)
const reais = (c: number): string => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// nmEntidade do CSV → seletor no banco (município Paranaguá/PR)
type AlvoEnt = { chave: (n: string) => boolean; tipo: TipoEntidade; nomeBanco: string; onboard: boolean }
const ENTIDADES: AlvoEnt[] = [
  { chave: (n) => n.includes('MUNICIPIO'), tipo: 'PREFEITURA', nomeBanco: 'Prefeitura Municipal de Paranaguá', onboard: false },
  { chave: (n) => n.includes('PREVIDENCIA'), tipo: 'ADM_INDIRETA', nomeBanco: 'Paranaguá Previdência', onboard: false },
  { chave: (n) => n.includes('FUNDA'), tipo: 'ADM_INDIRETA', nomeBanco: 'Fundação de Assistência à Saúde de Paranaguá', onboard: true },
]

const SEG = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2] // larguras do código pontuado (18 díg)
function segmentos(cod19: string): string[] {
  const d = cod19.slice(1) // dropa o 1º dígito (4=receita, 9=redutora)
  const out: string[] = []
  let p = 0
  for (const w of SEG) { out.push(d.slice(p, p + w)); p += w }
  return out
}
const codigoParaConta = (cod19: string): string => segmentos(cod19).join('.')
const significativo = (cod19: string): string => cod19.replace(/0+$/, '') || cod19
function nivelDe(segs: string[]): number {
  let n = 1
  for (let i = 0; i < segs.length; i++) if (parseInt(segs[i]!, 10) !== 0) n = i + 1
  return n
}
// códigos pontuados dos ancestrais (nível 1..nível), zerando os segmentos abaixo de k
function cadeiaAncestrais(segs: string[], nivel: number): string[] {
  const codes: string[] = []
  for (let k = 1; k <= nivel; k++) codes.push(segs.map((s, i) => (i < k ? s : '0'.repeat(s.length))).join('.'))
  return codes
}

type Linha = { ent: string; cod19: string; desc: string; valor: number; deducao: boolean }
function parseCsv(txt: string): Linha[] {
  const linhas: Linha[] = []
  const rows = txt.split(/\r?\n/).filter((l) => l.trim())
  for (const row of rows.slice(1)) {
    const f = row.split(';').map((c) => c.replace(/^"|"$/g, ''))
    if (f.length < 6) continue
    const [ent, cod19, desc, desdobr, fonte, categoria] = f as [string, string, string, string, string, string]
    // valor = a única das 3 colunas de escada que é != 0
    const valor = [cent(desdobr), cent(fonte), cent(categoria)].find((v) => v !== 0) ?? 0
    linhas.push({ ent, cod19, desc, valor, deducao: cod19.startsWith('9') })
  }
  return linhas
}

async function resolverEntidade(alvo: AlvoEnt, municipioId: string) {
  let ent = await prisma.entidade.findFirst({ where: { tipo: alvo.tipo, nome: alvo.nomeBanco, municipioId }, select: { id: true, nome: true } })
  if (!ent && alvo.onboard) {
    if (APPLY) {
      const criada = await new EntidadeService(prisma).criar({ municipioId, nome: alvo.nomeBanco, tipo: alvo.tipo, ano: ANO })
      await prisma.orcamento.create({ data: { entidadeId: criada.id, ano: ANO, status: 'RASCUNHO' } })
      ent = { id: criada.id, nome: criada.nome }
      console.log(`  ✓ onboard: ${alvo.nomeBanco} (${criada.id})`)
    } else {
      console.log(`  • [dry-run] onboardaria: ${alvo.nomeBanco}`)
      return null
    }
  }
  return ent
}

async function main() {
  console.log(`\n═══ Previsão da receita ${ANO} — CSV IPM → Gênesis (Paranaguá) ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const municipio = await prisma.municipio.findFirstOrThrow({ where: { nome: 'Paranaguá', estado: { is: { sigla: 'PR' } } }, select: { id: true } })
  const linhas = parseCsv(readFileSync(CSV, 'latin1'))
  console.log(`CSV: ${linhas.length} linhas.\n`)

  for (const alvo of ENTIDADES) {
    const doCsv = linhas.filter((l) => alvo.chave(l.ent.toUpperCase()))
    if (!doCsv.length) continue
    console.log(`══ ${alvo.nomeBanco} (${doCsv.length} linhas no CSV) ══`)

    // folhas: código significativo que não é prefixo de nenhum outro
    const sigs = doCsv.map((l) => significativo(l.cod19))
    const ehFolha = (l: Linha) => {
      const s = significativo(l.cod19)
      return !sigs.some((o) => o !== s && o.startsWith(s))
    }
    const folhas = doCsv.filter(ehFolha)
    const receita = folhas.filter((l) => !l.deducao)
    const deducoes = folhas.filter((l) => l.deducao)
    const somaBruta = receita.reduce((a, l) => a + l.valor, 0)
    const somaDed = deducoes.reduce((a, l) => a + l.valor, 0)
    // conferência: soma das folhas de receita = soma dos níveis-1 (categorias) positivos
    const nivel1 = doCsv.filter((l) => !l.deducao && significativo(l.cod19).length <= 2)
    const somaN1 = nivel1.reduce((a, l) => a + l.valor, 0)
    console.log(`  folhas receita: ${receita.length} · Σ bruta R$ ${reais(somaBruta)} (nível-1 Σ ${reais(somaN1)} — ${somaBruta === somaN1 ? 'OK' : `Δ ${reais(somaBruta - somaN1)}`})`)
    console.log(`  deduções (9…) sinalizadas: ${deducoes.length} · Σ R$ ${reais(somaDed)} → receita líquida R$ ${reais(somaBruta + somaDed)}`)

    const ent = await resolverEntidade(alvo, municipio.id)
    if (!ent) { console.log(''); continue }
    const orc = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId: ent.id, ano: ANO } }, select: { id: true } })
    if (!orc) { console.log(`  ⚠ sem orçamento ${ANO} — pulada\n`); continue }

    const contasDb = new Map(
      (await prisma.contaReceitaEntidade.findMany({ where: { entidadeId: ent.id, ano: ANO }, select: { codigo: true, id: true } })).map((c) => [c.codigo, c.id]),
    )
    const faltantes = receita.filter((l) => !contasDb.has(codigoParaConta(l.cod19)))
    console.log(`  contas casadas: ${receita.length - faltantes.length}/${receita.length}${faltantes.length ? ` · criar sob demanda: ${faltantes.length}` : ''}`)
    for (const l of faltantes) console.log(`      + ${l.cod19}→${codigoParaConta(l.cod19)} (${l.desc})`)

    if (!APPLY) { console.log(''); continue }

    await prisma.$transaction(
      async (tx) => {
        let fonteId = (await tx.fonteRecursoEntidade.findFirst({ where: { entidadeId: ent.id, ano: ANO, codigo: FONTE_PLACEHOLDER }, select: { id: true } }))?.id
        if (!fonteId)
          fonteId = (
            await tx.fonteRecursoEntidade.create({
              data: { entidadeId: ent.id, ano: ANO, codigo: FONTE_PLACEHOLDER, nomenclatura: 'Sem detalhamento de fonte (LOA receita IPM)', origem: 'DESDOBRAMENTO' },
              select: { id: true },
            })
          ).id

        // garante a conta da folha (criando ancestrais faltantes; nomes do paralelo cat-1/2)
        const garantirConta = async (cod19: string, descFolha: string): Promise<string> => {
          const segs = segmentos(cod19)
          const cadeia = cadeiaAncestrais(segs, nivelDe(segs))
          let parentId: string | null = null
          for (let k = 0; k < cadeia.length; k++) {
            const cod = cadeia[k]!
            let id = contasDb.get(cod)
            if (!id) {
              const folha = k === cadeia.length - 1
              const paralelo = cod.replace(/^7/, '1').replace(/^8/, '2')
              const nome = folha
                ? descFolha
                : (await tx.contaReceitaEntidade.findFirst({ where: { entidadeId: ent.id, ano: ANO, codigo: paralelo }, select: { descricao: true } }))?.descricao ?? `Intra-orçamentária ${cod}`
              id = (
                await tx.contaReceitaEntidade.create({
                  data: { entidadeId: ent.id, ano: ANO, codigo: cod, descricao: nome, nivel: k + 1, admiteMovimento: false, origem: 'DESDOBRAMENTO', parentId },
                  select: { id: true },
                })
              ).id
              contasDb.set(cod, id)
            }
            parentId = id
          }
          return parentId!
        }

        let n = 0
        for (const l of receita) {
          const contaId = await garantirConta(l.cod19, l.desc)
          const valor = (l.valor / 100).toFixed(2)
          await tx.previsaoReceita.upsert({
            where: { previsao_unica: { orcamentoId: orc.id, contaReceitaEntidadeId: contaId, fonteRecursoEntidadeId: fonteId } },
            create: { orcamentoId: orc.id, contaReceitaEntidadeId: contaId, fonteRecursoEntidadeId: fonteId, valorPrevisto: valor },
            update: { valorPrevisto: valor },
          })
          n++
        }
        console.log(`  [apply] previsões upsert: ${n} (fonte placeholder ${FONTE_PLACEHOLDER})\n`)
      },
      { timeout: 120_000 },
    )
  }
}

main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => {
  await prisma.$disconnect()
  await pool.end()
})
