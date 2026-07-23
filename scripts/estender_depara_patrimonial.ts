/**
 * Estende o de/para PATRIMONIAL (ParametroReceita NR→VPA e ParametroDespesa
 * ND→VPD/passivo) com entradas GROSSAS por prefixo — o que destrava as pernas
 * patrimoniais (E300/E702/E802 → CAIXA) na materialização do razão dos municípios
 * importados, cuja natureza vem truncada (SICONFI = modalidade; IPM = 3 níveis).
 *
 * As regras seguem o roteiro de contabilização do MCASP (correspondência NR↔VPA e
 * ND↔VPD/ativo/dívida) no nível MAIS GROSSO honesto: onde a natureza truncada não
 * permite split (ex.: 4.4.90 sem elemento), a nota documenta a escolha. As entradas
 * FINAS existentes prevalecem sempre (matching por prefixo mais longo do motor).
 * Tudo editável depois no admin — isto é ponto de partida canônico, não chute:
 * cada conta-alvo é validada como folha [MOV] no plano do modelo antes de gravar.
 *
 * Dry-run imprime a tabela p/ aprovação + a cobertura (R$ executado com parâmetro)
 * antes/depois, por município. `--apply` grava (upsert; não toca entradas existentes).
 *
 *   npx tsx scripts/estender_depara_patrimonial.ts [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type CategoriaDespesa } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const R = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Completa um código pontuado até os 12 grupos do PCASP contábil. */
const pad = (c: string) => {
  const p = c.split('.')
  const g = [1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2]
  while (p.length < 12) p.push('0'.repeat(g[p.length] ?? 2))
  return p.join('.')
}

// ─── RECEITA: NR (prefixo) → VPA/contrapartida (E300) ────────────────────────
// Todas EFETIVA + regime CAIXA (municípios importados não têm lançamento
// tributário; as 4 entradas COMPETENCIA finas de Maringá permanecem).
const RECEITA: Array<{ prefixo: string; vpa: string; nota: string }> = [
  { prefixo: '1.1.1', vpa: '4.1.1.2.1.99', nota: 'impostos (grosso: patrimônio/renda; IPTU/ISS finos prevalecem)' },
  { prefixo: '1.1.1.4', vpa: '4.1.1.3.1.99', nota: 'ISS/produção-circulação (formato TCE)' },
  { prefixo: '1.1.1.8.02', vpa: '4.1.1.3.1.99', nota: 'ISS/produção-circulação (formato nacional)' },
  { prefixo: '1.1.2', vpa: '4.1.2.1.1.99', nota: 'taxas — poder de polícia (grosso)' },
  { prefixo: '1.1.2.2', vpa: '4.1.2.2.1.99', nota: 'taxas — prestação de serviços (TCE)' },
  { prefixo: '1.1.2.8.02', vpa: '4.1.2.2.1.99', nota: 'taxas — prestação de serviços (nacional)' },
  { prefixo: '1.1.3', vpa: '4.1.3.1.1.01', nota: 'contribuição de melhoria (única folha do plano)' },
  { prefixo: '1.2.1', vpa: '4.2.1.1.1.99', nota: 'contribuições sociais RPPS (segurado+patronal consolidação)' },
  { prefixo: '1.2.4', vpa: '4.2.3.1.1.01', nota: 'COSIP — iluminação pública' },
  { prefixo: '1.3.1', vpa: '4.3.3.1.1.99', nota: 'exploração do patrimônio (segue a âncora fina 1.3.1.1.01)' },
  { prefixo: '1.3.2', vpa: '4.4.5.2.1', nota: 'remuneração de depósitos/aplicações (VPA financeira)' },
  { prefixo: '1.3.3', vpa: '4.3.3.1.1.99', nota: 'delegação de serviços públicos (concessões — ex.: CAGEPAR)' },
  { prefixo: '1.3.4', vpa: '4.3.3.1.1.99', nota: 'exploração de direitos (cessão etc.)' },
  { prefixo: '1.6', vpa: '4.3.3.1.1.99', nota: 'receita de serviços' },
  { prefixo: '1.7.1', vpa: '4.5.2.1.3.99', nota: 'transferências da União (grosso; FPM fino prevalece)' },
  { prefixo: '1.7.1.3', vpa: '4.5.2.1.3.07', nota: 'SUS fundo a fundo (TCE)' },
  { prefixo: '1.7.2', vpa: '4.5.2.1.4.99', nota: 'transferências dos Estados (ICMS/IPVA…)' },
  { prefixo: '1.7.3', vpa: '4.5.4.1.1.99', nota: 'transf. de municípios (sem folha 4.5.2.1.5 no plano → multigov.)' },
  { prefixo: '1.7.4', vpa: '4.5.4.1.1.99', nota: 'transferências multigovernamentais' },
  { prefixo: '1.7.5', vpa: '4.5.2.2.4', nota: 'FUNDEB (via conta estadual; complementação União idem — grosso)' },
  { prefixo: '1.7.6', vpa: '4.5.3.1.1.99', nota: 'transferências de instituições privadas' },
  { prefixo: '1.7.9', vpa: '4.5.4.1.1.99', nota: 'outras transferências correntes' },
  { prefixo: '1.9', vpa: '4.9.9.9.1', nota: 'outras receitas correntes (fallback)' },
  { prefixo: '1.9.1', vpa: '4.4.2.4.1.99', nota: 'multas e juros de mora (VPA financeira)' },
  { prefixo: '1.9.2', vpa: '4.9.9.6.1.02', nota: 'restituições' },
  { prefixo: '1.9.2.1', vpa: '4.9.9.6.1.01', nota: 'indenizações' },
  { prefixo: '2.4', vpa: '4.5.2.1.3.99', nota: 'transf. de capital (convênios — predominantemente União; grosso)' },
  { prefixo: '2.9', vpa: '4.9.9.9.1', nota: 'outras receitas de capital (efetivas)' },
  { prefixo: '7.2.1', vpa: '4.2.1.1.2.01.01', nota: 'contribuição patronal intra-OFSS (RPPS recebe)' },
  { prefixo: '7.6', vpa: '4.9.9.9.2.99', nota: 'serviços intra-OFSS (VPA intra)' },
  { prefixo: '7.9', vpa: '4.9.9.9.2.99', nota: 'outras VPA intra-OFSS' },
]

// ─── DESPESA: ND (prefixo, até modalidade) → débito (VPD/ativo/dívida) + passivo ─
const DESPESA: Array<{ prefixo: string; debito: string; passivo: string; categoria: CategoriaDespesa; nota: string }> = [
  { prefixo: '3.1.90', debito: '3.1.1.1.1.01.01', passivo: '2.1.1.1.1.01.01', categoria: 'PESSOAL', nota: 'pessoal (grosso da modalidade; elementos finos prevalecem)' },
  { prefixo: '3.1.91', debito: '3.1.2.1.2.01', passivo: '2.1.1.4.1.01.01', categoria: 'PESSOAL', nota: 'encargos patronais intra (RPPS)' },
  { prefixo: '3.1.50', debito: '3.5.4.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'pessoal via ISFL (transferência concedida)' },
  { prefixo: '3.1.71', debito: '3.5.5.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'pessoal via consórcio (transferência a consórcio)' },
  { prefixo: '3.2.90', debito: '3.4.1.1.1.01', passivo: '2.1.2.1.1.02.01', categoria: 'JUROS', nota: 'juros da dívida' },
  { prefixo: '3.2.91', debito: '3.4.1.1.1.01', passivo: '2.1.2.1.1.02.01', categoria: 'JUROS', nota: 'juros intra (grosso: mesma folha consolidação)' },
  { prefixo: '3.3.90', debito: '3.3.2.3.1.99', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'custeio (grosso: outros serviços; elementos finos prevalecem)' },
  { prefixo: '3.3.91', debito: '3.3.2.3.1.99', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'custeio intra (folha intra é não-MOV → consolidação)' },
  { prefixo: '3.3.30', debito: '3.5.4.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'transferências a Estados (grosso: transf. concedidas)' },
  { prefixo: '3.3.31', debito: '3.5.4.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'transferências (grosso: transf. concedidas)' },
  { prefixo: '3.3.50', debito: '3.5.4.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'ISFL: subvenções/contratos de gestão (OSs de saúde etc.)' },
  { prefixo: '3.3.60', debito: '3.5.4.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'transferências a privadas (grosso)' },
  { prefixo: '3.3.67', debito: '3.5.5.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'consórcios — rateio' },
  { prefixo: '3.3.70', debito: '3.5.5.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'consórcios' },
  { prefixo: '3.3.71', debito: '3.5.5.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'consórcios' },
  { prefixo: '3.3.72', debito: '3.5.5.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'consórcios' },
  { prefixo: '3.3.80', debito: '3.5.4.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'transferências ao exterior/demais (grosso)' },
  { prefixo: '3.3.93', debito: '3.9.9.9.1', passivo: '2.1.3.1.1.01.01', categoria: 'CUSTEIO', nota: 'indenizações e restituições (VPD diversas)' },
  { prefixo: '4.4.90', debito: '1.2.3.2.1.01.03', passivo: '2.1.3.1.1.01.01', categoria: 'CAPITAL', nota: 'investimentos (grosso da modalidade → obras em andamento; 51/52/61 finos prevalecem)' },
  { prefixo: '4.4.30', debito: '3.5.4.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CAPITAL', nota: 'transf. de capital concedidas (grosso)' },
  { prefixo: '4.4.50', debito: '3.5.4.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CAPITAL', nota: 'transf. de capital a ISFL (grosso)' },
  { prefixo: '4.4.71', debito: '3.5.5.1.1', passivo: '2.1.3.1.1.01.01', categoria: 'CAPITAL', nota: 'transf. de capital a consórcios' },
  { prefixo: '4.6.90', debito: '2.2.2.1.1.02.98', passivo: '2.1.2.1.1.02.01', categoria: 'AMORTIZACAO', nota: 'amortização da dívida (baixa do passivo permanente)' },
  { prefixo: '4.6.91', debito: '2.2.2.1.1.02.98', passivo: '2.1.2.1.1.02.01', categoria: 'AMORTIZACAO', nota: 'amortização intra' },
]

const casa = (nat: string, pref: string) => nat === pref || nat.startsWith(pref + '.')

async function main() {
  console.log(`\n═══ Extensão do de/para patrimonial ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const modelos = await prisma.modeloContabil.findMany({ select: { id: true, descricao: true } })

  for (const modelo of modelos) {
    console.log(`\n─── Modelo ${modelo.descricao} ───`)
    const plano = await prisma.$queryRawUnsafe<{ codigo: string; admiteMovimento: boolean }[]>(
      `SELECT c.codigo, c."admiteMovimento" FROM contas c
       JOIN planos_de_contas pl ON pl.id = c."planoId"
       WHERE pl."modeloContabilId" = '${modelo.id}' AND pl.ano = 2026`,
    )
    const folhas = new Map(plano.map((c) => [c.codigo, c.admiteMovimento]))
    const valida = (cod: string): boolean => folhas.get(pad(cod)) === true

    const recExistentes = new Set((await prisma.parametroReceita.findMany({ where: { modeloContabilId: modelo.id }, select: { naturezaCodigo: true } })).map((p) => p.naturezaCodigo))
    const despExistentes = new Set((await prisma.parametroDespesa.findMany({ where: { modeloContabilId: modelo.id }, select: { naturezaCodigo: true } })).map((p) => p.naturezaCodigo))

    let recOk = 0
    for (const r of RECEITA) {
      if (recExistentes.has(r.prefixo)) { console.log(`  = receita ${r.prefixo} já existe — mantido`); continue }
      if (!valida(r.vpa)) { console.log(`  ✗ receita ${r.prefixo}: alvo ${r.vpa} NÃO é folha [MOV] — PULADO`); continue }
      recOk++
      if (APPLY) {
        await prisma.parametroReceita.create({
          data: { modeloContabilId: modelo.id, naturezaCodigo: r.prefixo, tipoMutacao: 'EFETIVA', indicadorReconhecimento: 'CAIXA', contaContrapartidaCodigo: pad(r.vpa) },
        })
      }
    }
    let despOk = 0
    for (const d of DESPESA) {
      if (despExistentes.has(d.prefixo)) { console.log(`  = despesa ${d.prefixo} já existe — mantido`); continue }
      if (!valida(d.debito) || !valida(d.passivo)) { console.log(`  ✗ despesa ${d.prefixo}: alvo ${d.debito}/${d.passivo} NÃO é folha [MOV] — PULADO`); continue }
      despOk++
      if (APPLY) {
        await prisma.parametroDespesa.create({
          data: { modeloContabilId: modelo.id, naturezaCodigo: d.prefixo, contaVpdCodigo: pad(d.debito), contaPassivoCodigo: pad(d.passivo), categoria: d.categoria },
        })
      }
    }
    console.log(`  ${APPLY ? 'gravadas' : 'a gravar'}: ${recOk} regras de receita + ${despOk} de despesa.`)
  }

  // cobertura por município (valor executado cuja natureza resolve algum parâmetro)
  console.log('\n─── Cobertura pós-extensão (execução com parâmetro / total) ───')
  const prefsRec = new Map<string, string[]>()
  const prefsDesp = new Map<string, string[]>()
  for (const m of modelos) {
    prefsRec.set(m.id, [
      ...(await prisma.parametroReceita.findMany({ where: { modeloContabilId: m.id }, select: { naturezaCodigo: true } })).map((p) => p.naturezaCodigo),
      ...(APPLY ? [] : RECEITA.map((r) => r.prefixo)),
    ])
    prefsDesp.set(m.id, [
      ...(await prisma.parametroDespesa.findMany({ where: { modeloContabilId: m.id }, select: { naturezaCodigo: true } })).map((p) => p.naturezaCodigo),
      ...(APPLY ? [] : DESPESA.map((d) => d.prefixo)),
    ])
  }
  const munis: { municipio: string; mid: string; nat: string; v: unknown; lado: string }[] = await prisma.$queryRawUnsafe(`
    SELECT m.nome AS municipio, COALESCE(m."modeloContabilId", est."modeloContabilId") AS mid, cr.codigo AS nat,
           SUM(CASE WHEN a.tipo='ESTORNO' THEN -a.valor ELSE a.valor END) AS v, 'R' AS lado
    FROM arrecadacoes a JOIN previsoes_receita p ON p.id=a."previsaoId" JOIN orcamentos o ON o.id=p."orcamentoId"
    JOIN entidades e ON e.id=o."entidadeId" JOIN municipios m ON m.id=e."municipioId" JOIN estados est ON est.id=m."estadoId"
    JOIN contas_receita_entidade cr ON cr.id=p."contaReceitaEntidadeId"
    WHERE a.tipo IN ('ARRECADACAO','ESTORNO') GROUP BY 1,2,3
    UNION ALL
    SELECT m.nome, COALESCE(m."modeloContabilId", est."modeloContabilId"), cd.codigo,
           SUM(me.valor), 'D'
    FROM movimentos_empenho me JOIN empenhos emp ON emp.id=me."empenhoId"
    JOIN dotacoes_despesa dd ON dd.id=emp."dotacaoDespesaId"
    JOIN contas_despesa_entidade cd ON cd.id=dd."contaDespesaEntidadeId"
    JOIN entidades e ON e.id=me."entidadeId" JOIN municipios m ON m.id=e."municipioId" JOIN estados est ON est.id=m."estadoId"
    WHERE me.tipo='PAGAMENTO' GROUP BY 1,2,3`)
  const acc = new Map<string, { rOk: number; rTot: number; dOk: number; dTot: number }>()
  const faltam = new Map<string, number>()
  for (const row of munis) {
    const a = acc.get(row.municipio) ?? { rOk: 0, rTot: 0, dOk: 0, dTot: 0 }
    const v = Number(row.v)
    const prefs = (row.lado === 'R' ? prefsRec : prefsDesp).get(row.mid) ?? []
    const ok = prefs.some((pf) => casa(row.nat, pf))
    if (row.lado === 'R') { a.rTot += v; if (ok) a.rOk += v }
    else { a.dTot += v; if (ok) a.dOk += v }
    if (!ok) faltam.set(row.nat, (faltam.get(row.nat) ?? 0) + v)
    acc.set(row.municipio, a)
  }
  for (const [mun, a] of [...acc].sort()) {
    console.log(`  ${mun}: receita ${a.rTot ? ((100 * a.rOk) / a.rTot).toFixed(1) : '—'}% de ${R(a.rTot)} · pagamento ${a.dTot ? ((100 * a.dOk) / a.dTot).toFixed(1) : '—'}% de ${R(a.dTot)}`)
  }
  const resto = [...faltam].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 15)
  if (resto.length) {
    console.log('  ⚠ ainda SEM parâmetro (top 15 por valor — ficam sem perna patrimonial, quantificado):')
    for (const [nat, v] of resto) console.log(`    ${nat}  ${R(v)}`)
  }
  if (!APPLY) console.log('\nDRY-RUN: nada gravado. Rode com --apply após conferir a tabela.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
