/**
 * LOA da CAGEPAR (Paranaguá/PR, 2026) — fecha o gap "execução sem orçado" que
 * deixava o 6.2.2.1.1 INVERTIDO (empenho 2,19mi sem fixação).
 *
 * FONTES (portal próprio `cagepar.atende.net`, exports de dados abertos que o
 * Marco baixa no navegador — o atende.net barra automação):
 *  - RECEITA (rotina 45081): `Relatorio (10).csv` → natureza 1.3.3 (Delegação de
 *    Serviços Públicos mediante concessão), R$ 4.578.300,00, fonte 000 (receita
 *    própria livre — mesma fonte de 14/16 dotações da execução).
 *  - DESPESA (rotina 45107): QDD 5.578.300,00 — arquivo `--despesa=<csv>` quando
 *    o Marco exportar. SEM ele, a despesa NÃO é provisionada (sem chute).
 *  - Δ 1.000.000 (despesa 5.578.300 − receita 4.578.300) = superávit financeiro
 *    de exercícios anteriores (art. 43 §1º II da 4.320) — fonte de equilíbrio,
 *    não é receita orçamentária.
 *
 * Ao final materializa o razão (abertura + replay da execução) via
 * `materializarRazao` — o mesmo núcleo do conversor. Dry-run por padrão.
 *
 *   npx tsx scripts/importar_loa_cagepar.ts [--despesa=/caminho/Relatorio.csv] [--apply]
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { escreverReceita } from '../src/conversor/nucleo/escrever-receita.js'
import { escreverDespesa } from '../src/conversor/nucleo/escrever-despesa.js'
import { reconciliarDespesa } from '../src/conversor/nucleo/reconciliar.js'
import { materializarRazao } from '../src/conversor/nucleo/materializar-razao.js'
import { pitTcePr } from '../src/conversor/tce/pr/pit.js'
import type { LinhaReceita, LinhaDespesa, MunicipioConfig, EntidadeConfig } from '../src/conversor/nucleo/tipos.js'

const ANO = 2026
const APPLY = process.argv.includes('--apply')
const despesaCsv = process.argv.find((a) => a.startsWith('--despesa='))?.split('=')[1]

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: number) => (n / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// RECEITA (do Relatorio (10).csv, valores conferidos ao centavo com a LOA):
// 1.3.3 Delegação de Serviços Públicos = 4.578.300,00 · fonte 000 (livre).
const RECEITA: LinhaReceita[] = [
  {
    naturezaPcasp: '1.3.3.0.00.0.0.00.00.00.00.00',
    fonte: { codigo: '000', descricao: 'Recursos Ordinários (Livres)' },
    previsto: 457_830_000, // centavos
  },
]

/**
 * DESPESA — `Relatorio (11).csv` (rotina 45107, dados abertos): QDD por
 * MODALIDADE. Formato IPM: colunas [Entidade, Conta, Descrição, Desdobramento,
 * Elemento, Categoria] — o VALOR aparece na coluna do NÍVEL da linha; as linhas
 * de MODALIDADE têm valor em "Desdobramento" (as demais são os pais/rollup).
 * Conta IPM: prefixo '3' + dígitos da natureza (ex. 3319→3.1.90 · 33191→3.1.91).
 * Σ modalidades = 5.653.300,00 (portal ATUALIZADO; anexo LOA 5.578.300 + 75.000
 * de créditos via superávit — mesmo padrão do Paranaguá). Verificado ao centavo.
 *
 * Dimensões: as MESMAS da execução real (PIT — todas as 16 dotações executadas):
 * UO 24.001 · função 04 · subfunção 122 · programa 0054 · ação 2230. Fonte 000.
 */
function lerDespesaCsv(caminho: string): LinhaDespesa[] {
  const raw = readFileSync(caminho, 'latin1')
  const linhas: LinhaDespesa[] = []
  for (const row of raw.split(/\r?\n/).slice(1)) {
    const cols = row.split(';').map((c) => c.replace(/^"|"$/g, '').trim())
    if (cols.length < 6) continue
    const conta = (cols[1] ?? '').replace(/\D/g, '')
    const modalidadeValor = Number((cols[3] ?? '').replace(',', '.')) // col "Desdobramento"
    if (!conta.startsWith('3') || !(modalidadeValor > 0)) continue // só linhas de modalidade
    const d = conta.slice(1) // strip do prefixo IPM '3'
    const nat = `${d[0]}.${d[1]}.${d.slice(2, 4)}.00.00.00` // modalidade, elemento 00
    linhas.push({
      orgao: { codigo: '24', nome: 'CAGEPAR' },
      unidade: { codigo: '001', nome: 'CAGEPAR - Central de Água, Esgoto e Serviços Concedidos' },
      funcao: '04',
      subfuncao: '122',
      programa: { codigo: '0054' },
      acao: { codigo: '2230' },
      naturezaPcasp: nat,
      fonte: { codigo: '000', descricao: 'Recursos Ordinários (Livres)' },
      autorizado: Math.round(modalidadeValor * 100),
    })
  }
  return linhas
}

async function main() {
  console.log(`\n═══ LOA CAGEPAR ${ANO} ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const ent = await prisma.entidade.findFirstOrThrow({
    where: { nome: { contains: 'CAGEPAR' }, municipio: { is: { nome: 'Paranaguá', estado: { is: { sigla: 'PR' } } } } },
    select: { id: true, nome: true },
  })
  const orc = await prisma.orcamento.findUniqueOrThrow({ where: { entidadeId_ano: { entidadeId: ent.id, ano: ANO } }, select: { id: true } })
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })

  console.log(`${ent.nome}`)
  console.log(`  receita: 1.3.3 Delegação de Serviços Públicos · fonte 000 · previsto R$ ${R(457_830_000)}`)
  const despesa = despesaCsv ? lerDespesaCsv(despesaCsv) : []
  if (despesaCsv) console.log(`  despesa (CSV): ${despesa.length} linhas · Σ autorizado R$ ${R(despesa.reduce((s, d) => s + (d.autorizado ?? 0), 0))}`)
  else console.log('  despesa: SEM CSV (--despesa=) — não provisiono (aguardando export da rotina 45107)')

  if (!APPLY) { console.log('\nDRY-RUN: nada gravado. Rode com --apply.'); return }

  const r = await escreverReceita(prisma, orc.id, ent.id, ANO, RECEITA)
  console.log(`  ✓ receita gravada (${r.previsoes} previsões, ${r.contasCriadas} contas criadas)`)
  if (despesa.length) {
    // ⚠️ escreverDespesa espera linhas RECONCILIADAS (LOA + execução): ele limpa o
    // ledger CAP-* da entidade e apaga dotações órfãs — passar SÓ a LOA varre a
    // execução (aconteceu em 2026-07-22; recuperado do PIT). SEMPRE reconciliar.
    const cfg = { nome: 'Paranaguá', ibge: '411820', uf: 'PR', ano: ANO, fabricante: 'ipm', tce: 'pr', entidades: [] } as unknown as MunicipioConfig
    const entCfg = { nome: ent.nome, tipo: 'ADM_INDIRETA', matchPit: 'CENTRAL' } as EntidadeConfig
    const exec = await pitTcePr.lerExecucao(cfg, entCfg)
    const merged = reconciliarDespesa(despesa, exec)
    const d = await escreverDespesa(prisma, orc.id, ent.id, ANO, merged, { historico: `EXECUÇÃO PIT ${ANO} (LOA CAGEPAR)` })
    console.log(`  ✓ despesa gravada (${d.dotacoes} dotações, com empenho ${d.comEmpenho})`)
  }
  const raz = await materializarRazao(prisma, ent.id, ANO, usuario.id)
  console.log(`  ✓ razão materializado (abertura + ${raz.arrecadacoes} arrec + ${raz.movimentos} movimentos)`)

  // verificação: 6.2.2.1.1 deve ficar credor se a despesa foi provisionada
  const conta = await prisma.contaContabilEntidade.findFirst({ where: { entidadeId: ent.id, ano: ANO, codigo: { startsWith: '6.2.2.1.1' } }, select: { id: true } })
  if (conta) {
    const g = await prisma.lancamentoItem.groupBy({ by: ['tipo'], where: { conta: { entidadeId: ent.id, codigo: { startsWith: '6.2.2.1.1' } } }, _sum: { valor: true } })
    const credor = new Prisma.Decimal(g.find((x) => x.tipo === 'CREDITO')?._sum.valor ?? 0).minus(new Prisma.Decimal(g.find((x) => x.tipo === 'DEBITO')?._sum.valor ?? 0))
    console.log(`  verificação 6.2.2.1.1 (credor): R$ ${Number(credor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${credor.gte(0) ? '✓ sem inversão' : '✗ AINDA INVERTIDO (falta a despesa)'}`)
  }
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
