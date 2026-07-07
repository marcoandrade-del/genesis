/**
 * EXECUÇÃO DA DESPESA 2026 das demais entidades de Maringá (Câmara,
 * Previdência, AMR, IPPLAM, IAM) — captura do portal da transparência,
 * mês a mês, no MESMO padrão da captura da Prefeitura (sincronizacao-portal):
 * empenho sintético CAP-{id8} por dotação + MovimentoEmpenho com os valores
 * DO PERÍODO (empenhado/liquidado/pago líquidos), idempotente por histórico
 * mensal, rateio multi-fonte ∝ autorizado, rematerialização de empenho/dotação.
 *
 * Fontes do portal (contrato em portal-maringa-api-arquivos.md):
 *   - /despesapornivel/detalhada?dataInicial&dataFinal (headers entidade+exercicio)
 *     → nível 11 traz `programatica` = orgao.uo.funcao.subfuncao.programa.acao.natureza
 *   - /api/dashboard/arrecadacao-despesa (header entidade) → GUARD: Σ nível 11
 *     do mês TEM que bater o dashboard antes de gravar (mesma disciplina do sync).
 *
 * IDs do portal: 6=Câmara · 3=Previdência · 9=AMR · 15=IPPLAM · 4=IAM.
 * Pré-requisito: orçamentos criados por importar_orcamento_entidades_2026.ts.
 * A validação externa (PIT/TCE-PR) fica com scripts/importar_execucao_pit.ts
 * (--entidade-banco/--pit-entidade).
 *
 * Rodar: npx tsx scripts/importar_execucao_entidades_2026.ts [--apply]
 *        [--meses 1-6] [--so <parte-do-nome-da-entidade>]
 */

import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
function arg(nome: string, padrao: string): string {
  const i = process.argv.indexOf(nome)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao
}
const ANO = 2026
const [MES_INI, MES_FIM] = arg('--meses', '1-6').split('-').map((n) => parseInt(n, 10))
const SO = arg('--so', '')
const BASE = process.env['PORTAL_MARINGA_URL'] ?? 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'

const ENTIDADES: { portal: string; buscar: RegExp }[] = [
  { portal: '6', buscar: /c[âa]mara/i },
  { portal: '3', buscar: /previd[êe]ncia/i },
  { portal: '9', buscar: /regula[çc][ãa]o/i },
  { portal: '15', buscar: /IPPLAM/i },
  { portal: '4', buscar: /ambiental/i },
]

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (c: number): string =>
  (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cent = (n: number): number => Math.round(n * 100)
const r2 = (n: number): number => Math.round(n * 100) / 100

async function getJson<T>(path: string, headers: Record<string, string>): Promise<T> {
  for (let t = 0; t < 3; t++) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`)
      return (await res.json()) as T
    } catch (e) {
      if (t === 2) throw e
      await new Promise((r) => setTimeout(r, 1500 * (t + 1)))
    }
  }
  throw new Error('inalcançável')
}

type Nivel11 = { programatica: string | null; nivel: number | string; valorEmpenhado: number; valorLiquidado: number; valorPago: number }
type DashMes = { mes: number; valorEmpenhado: number; valorPago: number }

async function main() {
  console.log(`\n═══ Execução ${ANO} (meses ${MES_INI}–${MES_FIM}) das demais entidades — portal (${APPLY ? 'APPLY' : 'dry-run'}) ═══`)

  const municipio = await prisma.municipio.findFirst({
    where: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } },
    select: { id: true },
  })
  if (!municipio) throw new Error('município não encontrado')
  const candidatas = await prisma.entidade.findMany({ where: { municipioId: municipio.id }, select: { id: true, nome: true } })

  let fornecedor = await prisma.fornecedor.findFirst({ where: { razaoSocial: 'CAPTURA PORTAL DA TRANSPARÊNCIA' }, select: { id: true } })
  if (!fornecedor && APPLY)
    fornecedor = await prisma.fornecedor.create({
      data: { tipoPessoa: 'PJ', razaoSocial: 'CAPTURA PORTAL DA TRANSPARÊNCIA', nomeFantasia: 'Execução capturada do portal (não é credor real)' },
      select: { id: true },
    })
  const usuario = await prisma.usuario.findFirst({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  if (!usuario) throw new Error('sem usuário p/ criadoPorId')

  for (const cfg of ENTIDADES) {
    const entidade = candidatas.find((c) => cfg.buscar.test(c.nome))
    if (!entidade) throw new Error(`entidade do portal ${cfg.portal} não encontrada no banco`)
    if (SO && !entidade.nome.toLowerCase().includes(SO.toLowerCase())) continue
    console.log(`\n▶ ${entidade.nome} (portal ${cfg.portal})`)

    const orcamento = await prisma.orcamento.findUnique({
      where: { entidadeId_ano: { entidadeId: entidade.id, ano: ANO } },
      select: { id: true },
    })
    if (!orcamento) throw new Error(`"${entidade.nome}" sem orçamento ${ANO} — rode importar_orcamento_entidades_2026 antes`)

    // dotações → índice por chave programática (multi-fonte agrupa p/ rateio)
    const dots = await prisma.dotacaoDespesa.findMany({
      where: { orcamentoId: orcamento.id },
      select: {
        id: true,
        valorAutorizado: true,
        unidadeOrcamentaria: { select: { codigo: true } },
        funcao: { select: { codigo: true } },
        subfuncao: { select: { codigo: true } },
        programa: { select: { codigo: true } },
        acao: { select: { codigo: true } },
        contaDespesa: { select: { codigo: true } },
      },
    })
    const porChave = new Map<string, { id: string; autorizado: number }[]>()
    for (const d of dots) {
      const k = `${d.unidadeOrcamentaria.codigo}|${d.funcao.codigo}|${d.subfuncao.codigo}|${d.programa.codigo}|${d.acao.codigo}|${d.contaDespesa.codigo}`
      const arr = porChave.get(k) ?? []
      arr.push({ id: d.id, autorizado: Number(d.valorAutorizado) })
      porChave.set(k, arr)
    }

    // guard mensal: dashboard oficial da entidade
    const dash = await getJson<DashMes[]>(`/api/dashboard/arrecadacao-despesa?exercicio=${ANO}`, {
      entidade: cfg.portal,
      exercicio: String(ANO),
    })
    const dashPorMes = new Map(dash.map((m) => [Number(m.mes), m]))

    for (let mes = MES_INI; mes <= MES_FIM; mes++) {
      const ultimoDia = new Date(Date.UTC(ANO, mes, 0)).getUTCDate()
      const itens = await getJson<Nivel11[]>(
        `/despesapornivel/detalhada?dataInicial=${ANO}-${String(mes).padStart(2, '0')}-01&dataFinal=${ANO}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`,
        { entidade: cfg.portal, exercicio: String(ANO) },
      )
      const n11 = itens.filter((i) => String(i.nivel) === '11' && i.programatica)
      const somaMes = cent(n11.reduce((s, i) => s + (i.valorEmpenhado || 0), 0))
      const dashMes = cent(dashPorMes.get(mes)?.valorEmpenhado ?? 0)
      const okGuard = Math.abs(somaMes - dashMes) <= 100 // R$ 1,00
      console.log(
        `  ${String(mes).padStart(2, '0')}/${ANO}: nível11 ${n11.length} itens · Σ emp ${reais(somaMes)} × dashboard ${reais(dashMes)} ${okGuard ? '✓' : '✗ DIVERGE'}`,
      )
      if (!okGuard) {
        console.error('  ABORTADO: guard do dashboard falhou — não gravo divergente.')
        process.exit(1)
      }
      if (somaMes === 0 && dashMes === 0) continue

      // deltas por dotação (rateio ∝ autorizado nas chaves multi-fonte)
      const deltas = new Map<string, { emp: number; liq: number; pag: number }>()
      const semDotacao: string[] = []
      for (const item of n11) {
        // programatica = orgao.uo.funcao.subfuncao.programa.acao.natureza(4 grupos)
        const m = item.programatica!.match(/^(\d{2})\.(\d{3})\.(\d{2})\.(\d{3})\.(\d{4})\.(\d{4})\.(\d\.\d\.\d\d\.\d\d)$/)
        if (!m) {
          semDotacao.push(`programática inesperada: ${item.programatica}`)
          continue
        }
        const chave = `${m[1]}.${m[2]}|${m[3]}|${m[4]}|${m[5]}|${m[6]}|${m[7]}.00.00`
        const alvos = porChave.get(chave)
        if (!alvos) {
          semDotacao.push(`${item.programatica} (emp ${reais(cent(item.valorEmpenhado || 0))})`)
          continue
        }
        const totalAut = alvos.reduce((s, a) => s + a.autorizado, 0)
        for (const [i, a] of alvos.entries()) {
          // último alvo leva o resíduo do arredondamento (preserva Σ)
          const frac = totalAut > 0 ? a.autorizado / totalAut : 1 / alvos.length
          const parte = (v: number) => {
            const total = cent(v || 0)
            if (i < alvos.length - 1) return Math.round(total * frac)
            const antes = alvos.slice(0, -1).reduce((s, b) => s + Math.round(total * (totalAut > 0 ? b.autorizado / totalAut : 1 / alvos.length)), 0)
            return total - antes
          }
          const d = deltas.get(a.id) ?? { emp: 0, liq: 0, pag: 0 }
          d.emp += parte(item.valorEmpenhado)
          d.liq += parte(item.valorLiquidado)
          d.pag += parte(item.valorPago)
          deltas.set(a.id, d)
        }
      }
      if (semDotacao.length) {
        console.error(`  ABORTADO: ${semDotacao.length} programática(s) do portal sem dotação no banco:`)
        for (const s of semDotacao.slice(0, 6)) console.error('    ' + s)
        process.exit(1)
      }
      if (!APPLY) continue

      const historico = `CAPTURA PORTAL despesa ${String(mes).padStart(2, '0')}/${ANO}`
      const dataMov = new Date(Date.UTC(ANO, mes, 0))
      await prisma.$transaction(
        async (tx) => {
          const ids = [...deltas.keys()]
          const existentes = await tx.empenho.findMany({
            where: { entidadeId: entidade.id, dotacaoDespesaId: { in: ids }, numero: { startsWith: 'CAP-' } },
            select: { id: true, dotacaoDespesaId: true },
          })
          const empPorDot = new Map(existentes.map((e) => [e.dotacaoDespesaId, e.id]))
          for (const id of ids) {
            if (empPorDot.has(id)) continue
            const novo = await tx.empenho.create({
              data: {
                entidadeId: entidade.id,
                dotacaoDespesaId: id,
                fornecedorId: fornecedor!.id,
                numero: `CAP-${id.slice(0, 8)}`,
                tipo: 'ESTIMATIVO',
                data: dataMov,
                valor: 0,
                historico: 'Empenho de CAPTURA da execução do portal (não é escrituração).',
              },
              select: { id: true },
            })
            empPorDot.set(id, novo.id)
          }
          await tx.movimentoEmpenho.deleteMany({ where: { entidadeId: entidade.id, historico } })
          const rows: {
            entidadeId: string
            empenhoId: string
            tipo: 'EMPENHO' | 'ESTORNO_EMPENHO' | 'LIQUIDACAO' | 'ESTORNO_LIQUIDACAO' | 'PAGAMENTO' | 'ESTORNO_PAGAMENTO'
            valor: number
            data: Date
            criadoPorId: string
            historico: string
          }[] = []
          for (const [dotId, d] of deltas) {
            const eId = empPorDot.get(dotId)!
            const push = (
              c: number,
              pos: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO',
              neg: 'ESTORNO_EMPENHO' | 'ESTORNO_LIQUIDACAO' | 'ESTORNO_PAGAMENTO',
            ) => {
              if (!c) return
              rows.push({ entidadeId: entidade.id, empenhoId: eId, tipo: c > 0 ? pos : neg, valor: Math.abs(c) / 100, data: dataMov, criadoPorId: usuario.id, historico })
            }
            push(d.emp, 'EMPENHO', 'ESTORNO_EMPENHO')
            push(d.liq, 'LIQUIDACAO', 'ESTORNO_LIQUIDACAO')
            push(d.pag, 'PAGAMENTO', 'ESTORNO_PAGAMENTO')
          }
          await tx.movimentoEmpenho.createMany({ data: rows })
          for (const [dotId, empId] of empPorDot) {
            const ag = await tx.movimentoEmpenho.groupBy({ by: ['tipo'], where: { empenhoId: empId }, _sum: { valor: true } })
            const s = (t: string) => Number(ag.find((g) => g.tipo === t)?._sum.valor ?? 0)
            const emp = r2(s('EMPENHO') - s('ESTORNO_EMPENHO'))
            const liq = r2(s('LIQUIDACAO') - s('ESTORNO_LIQUIDACAO'))
            await tx.empenho.update({ where: { id: empId }, data: { valor: emp, valorLiquidado: liq } })
            await tx.dotacaoDespesa.update({ where: { id: dotId }, data: { valorEmpenhado: emp } })
          }
        },
        { timeout: 120000 },
      )
      console.log(`    gravado (${deltas.size} dotações)`)
    }

    // conferência acumulada pós-apply
    if (APPLY) {
      const movs = await prisma.movimentoEmpenho.groupBy({
        by: ['tipo'],
        where: { entidadeId: entidade.id, data: { gte: new Date(`${ANO}-01-01`), lte: new Date(`${ANO}-12-31`) } },
        _sum: { valor: true },
      })
      const s = (t: string) => Number(movs.find((g) => g.tipo === t)?._sum.valor ?? 0)
      const emp = r2(s('EMPENHO') - s('ESTORNO_EMPENHO'))
      const alvo = dash.filter((m) => Number(m.mes) >= MES_INI && Number(m.mes) <= MES_FIM).reduce((x, m) => x + (m.valorEmpenhado || 0), 0)
      console.log(`  Σ empenhado no banco: ${reais(cent(emp))} × dashboard ${MES_INI}–${MES_FIM}: ${reais(cent(alvo))} ${cent(emp) === cent(alvo) ? '✓ AO CENTAVO' : '≠'}`)
    }
  }

  console.log(`\n${APPLY ? 'Concluído.' : 'Dry-run — nada gravado. Rode com --apply.'}\n`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('FALHOU:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
