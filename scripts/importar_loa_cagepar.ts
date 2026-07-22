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
import { LancamentosService } from '../src/services/lancamentos.js'
import { AberturaContabilService } from '../src/services/abertura-contabil.js'
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
 * DESPESA — `Relatorio (12).csv` (rotina 45107, dados abertos): QDD por
 * ELEMENTO. Colunas [Entidade, Categoria "3 - …", Grupo "1 - …", Elemento
 * "11 - …", Código, Descrição, Prevista para o Ano, Liquidado até o Mês, %].
 * Natureza = categoria.grupo.MODALIDADE(do código IPM: 3319→90 · 33191→91).
 * elemento(da coluna). Σ prevista = 5.653.300,00 = QDD por modalidade ✓ (portal
 * ATUALIZADO; anexo LOA 5.578.300 + 75.000 créditos via superávit). O liquidado
 * do CSV é usado só como VALIDAÇÃO cruzada (a execução materializada vem do PIT).
 *
 * Dimensões: as MESMAS da execução real (PIT): UO 24.001 · função 04 ·
 * subfunção 122 · programa 0054 · ação 2230. Fonte 000 — no MESMO nível do PIT,
 * então a reconciliação casa LOA e execução na MESMA dotação.
 */
function lerDespesaCsv(caminho: string): { linhas: LinhaDespesa[]; liquidadoCsv: number } {
  const raw = readFileSync(caminho, 'latin1')
  const linhas: LinhaDespesa[] = []
  let liquidadoCsv = 0
  for (const row of raw.split(/\r?\n/).slice(1)) {
    const cols = row.split('";"').map((c) => c.replace(/^"|"$/g, '').trim())
    if (cols.length < 8) continue
    const cat = cols[1]?.split(' - ')[0] ?? ''
    const grupo = cols[2]?.split(' - ')[0] ?? ''
    const elem = cols[3]?.split(' - ')[0] ?? ''
    const cod = (cols[4] ?? '').replace(/\D/g, '')
    const prevista = Number(cols[6] || 0)
    const liquidado = Number(cols[7] || 0)
    if (!cod.startsWith('3') || !cat || !elem) continue
    liquidadoCsv += liquidado
    if (!(prevista > 0)) continue // elemento sem dotação (só execução residual) fica fora da LOA
    const mod = cod.slice(1).slice(2, 4) // 3319→90 · 33191→91
    const nat = `${cat}.${grupo}.${mod}.${elem.padStart(2, '0')}.00.00`
    linhas.push({
      orgao: { codigo: '24', nome: 'CAGEPAR' },
      unidade: { codigo: '001', nome: 'CAGEPAR - Central de Água, Esgoto e Serviços Concedidos' },
      funcao: '04',
      subfuncao: '122',
      programa: { codigo: '0054' },
      acao: { codigo: '2230' },
      naturezaPcasp: nat,
      fonte: { codigo: '000', descricao: 'Recursos Ordinários (Livres)' },
      autorizado: Math.round(prevista * 100),
    })
  }
  return { linhas, liquidadoCsv }
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
  const csv = despesaCsv ? lerDespesaCsv(despesaCsv) : { linhas: [], liquidadoCsv: 0 }
  if (despesaCsv) console.log(`  despesa (CSV, por ELEMENTO): ${csv.linhas.length} linhas · Σ autorizado R$ ${R(csv.linhas.reduce((s, d) => s + (d.autorizado ?? 0), 0))} · Σ liquidado (CSV, p/ validação) R$ ${csv.liquidadoCsv.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  else console.log('  despesa: SEM CSV (--despesa=) — não provisiono (aguardando export da rotina 45107)')

  if (!APPLY) { console.log('\nDRY-RUN: nada gravado. Rode com --apply.'); return }

  const r = await escreverReceita(prisma, orc.id, ent.id, ANO, RECEITA)
  console.log(`  ✓ receita gravada (${r.previsoes} previsões, ${r.contasCriadas} contas criadas)`)
  if (csv.linhas.length) {
    // ⚠️ escreverDespesa espera linhas RECONCILIADAS (LOA + execução): ele limpa o
    // ledger CAP-* da entidade e apaga dotações órfãs — passar SÓ a LOA varre a
    // execução (aconteceu em 2026-07-22; recuperado do PIT). SEMPRE reconciliar.
    const cfg = { nome: 'Paranaguá', ibge: '411820', uf: 'PR', ano: ANO, fabricante: 'ipm', tce: 'pr', entidades: [] } as unknown as MunicipioConfig
    const entCfg = { nome: ent.nome, tipo: 'ADM_INDIRETA', matchPit: 'CENTRAL' } as EntidadeConfig
    const exec = await pitTcePr.lerExecucao(cfg, entCfg)
    const liqPit = exec.reduce((s, l) => s + (l.liquidado ?? 0), 0)
    console.log(`  validação cruzada liquidado: CSV ${csv.liquidadoCsv.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} × PIT ${R(liqPit)} (Δ ${(csv.liquidadoCsv - liqPit / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — períodos podem diferir; PIT é a fonte)`)
    const merged = reconciliarDespesa(csv.linhas, exec)

    // ciclo completo: as dotações da forma ANTERIOR (modalidade) têm lançamentos de
    // abertura com cc de dotação → não sairiam como órfãs. Limpa a execução do
    // razão + estorna a abertura ANTES de reescrever; o materializarRazao ao final
    // recontabiliza a abertura (agora por elemento) e faz o replay da execução.
    const lancs = new LancamentosService(prisma)
    const antigos = await prisma.lancamento.findMany({ where: { entidadeId: ent.id, origemTipo: { in: ['ARRECADACAO', 'EMPENHO', 'LIQUIDACAO', 'PAGAMENTO'] } }, select: { id: true } })
    console.log(`  limpando ${antigos.length} lançamentos de execução...`)
    for (const l of antigos) await lancs.excluir(l.id)
    const abertura = new AberturaContabilService(prisma)
    const st = await abertura.status(ent.id, ANO)
    if (st.contabilizada) { await abertura.estornar(ent.id, ANO, usuario.id); console.log('  ✓ abertura anterior estornada') }

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
