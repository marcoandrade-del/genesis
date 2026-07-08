/**
 * RECEITA 2026 das demais entidades de Maringá (previsão + arrecadação) — do
 * portal da transparência, por entidade, no mesmo esquema da receita da
 * Prefeitura (importar_orcamento_maringa_2026.ts). Completa a consolidação
 * por ente: sem a receita das entidades a RCL/receita consolidada é meia-verdade.
 *
 * Foco real (sonda 2026-07-07): só o RPPS (Maringá Previdência) e o IAM têm
 * receita própria relevante; Câmara/AMR/IPPLAM ~0 (vivem de transferência/
 * duodécimo). O RPPS tem a RECEITA INTRA-ORÇAMENTÁRIA (categoria 7 —
 * "7.2.1.5.02…", contribuição patronal de cada entidade ao fundo): Σ jan-jun
 * 44,51mi, espelho da despesa modalidade 91 da Prefeitura — os dois lados da
 * eliminação intra fecham.
 *
 * Fonte: /api/receitas (árvore de descrições) + /api/receitas/fonte-recursos
 * (fontes) + /api/receitas/fonte-recursos/detalhes (natureza×fonte, com
 * valorOrcadoAtualizado e valorArrecadado do período). Header `entidade`.
 * IDs do portal: 3=Previdência · 4=IAM · 9=AMR · 15=IPPLAM (Câmara 6 = 0, pulada).
 *
 * Grava PrevisaoReceita (valorPrevisto = orçado atualizado; valorArrecadado =
 * arrecadado acumulado do período) no Orcamento JÁ existente da entidade
 * (criado pelo import de despesa #213). Cria ContaReceitaEntidade ausentes
 * (desdobramentos, incl. a árvore cat-7 que não está no plano-modelo) e
 * FonteRecursoEntidade ausentes. Idempotente: apaga as previsões do orçamento
 * antes de regravar. Guard: Σ arrecadado × dashboard da entidade.
 *
 * Rodar: npx tsx scripts/importar_receita_entidades_2026.ts [--apply]
 *        [--ate 2026-06-30] [--so <parte-do-nome>]
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
const ATE = arg('--ate', '2026-06-30')
const SO = arg('--so', '')
const BASE = process.env['PORTAL_MARINGA_URL'] ?? 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api'

const ENTIDADES: { portal: string; buscar: RegExp }[] = [
  { portal: '3', buscar: /previd[êe]ncia/i },
  { portal: '4', buscar: /ambiental/i },
  { portal: '9', buscar: /regula[çc][ãa]o/i },
  { portal: '15', buscar: /IPPLAM/i },
]

// ── helpers de código de receita (12 grupos), espelhados do import da Prefeitura
const GRUPOS_RECEITA = [1, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2]
function pad12(codigo: string): string {
  const partes = codigo.split('.')
  for (let i = partes.length; i < 12; i++) partes.push('0'.repeat(GRUPOS_RECEITA[i]!))
  return partes.slice(0, 12).join('.')
}
function agruparDigitos(raw: string): string {
  const partes: string[] = []
  let i = 0
  for (const g of GRUPOS_RECEITA) {
    if (i >= raw.length) break
    partes.push(raw.slice(i, i + g))
    i += g
  }
  return partes.join('.')
}
function nivelReceita(codigo12: string): number {
  const partes = codigo12.split('.')
  let n = 0
  for (let i = 0; i < 12; i++) if (partes[i] && parseInt(partes[i]!, 10) > 0) n = i + 1
  return Math.max(n, 1)
}
function paiReceita(codigo12: string): string {
  const partes = codigo12.split('.')
  const n = nivelReceita(codigo12)
  partes[n - 1] = '0'.repeat(GRUPOS_RECEITA[n - 1]!)
  return partes.join('.')
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (c: number): string =>
  (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cent = (n: number): number => Math.round((n || 0) * 100)

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

type FonteDto = { receita: string }
type DetalheDto = { receita: string; descricao: string; valorArrecadado: number; valorOrcadoAtualizado: number }
type ArvoreDto = { receita: string; descricao: string }
type DashDto = { valorArrecadado: number }

async function main() {
  console.log(`\n═══ Receita ${ANO} (até ${ATE}) das demais entidades — portal (${APPLY ? 'APPLY' : 'dry-run'}) ═══`)
  const municipio = await prisma.municipio.findFirst({
    where: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } },
    select: { id: true },
  })
  if (!municipio) throw new Error('município não encontrado')
  const candidatas = await prisma.entidade.findMany({ where: { municipioId: municipio.id }, select: { id: true, nome: true } })

  for (const cfg of ENTIDADES) {
    const entidade = candidatas.find((c) => cfg.buscar.test(c.nome))
    if (!entidade) throw new Error(`entidade do portal ${cfg.portal} não encontrada`)
    if (SO && !entidade.nome.toLowerCase().includes(SO.toLowerCase())) continue
    console.log(`\n▶ ${entidade.nome} (portal ${cfg.portal})`)

    const orcamento = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId: entidade.id, ano: ANO } }, select: { id: true } })
    if (!orcamento) throw new Error(`"${entidade.nome}" sem orçamento ${ANO}`)

    // catálogo de descrições (árvore do portal) + fallback pelas folhas
    const arvore = await getJson<ArvoreDto[]>(`/api/receitas?entidade=${cfg.portal}&exercicio=${ANO}`, { entidade: cfg.portal, exercicio: String(ANO) })
    const descPorConta = new Map<string, string>()
    for (const a of arvore) descPorConta.set(pad12(agruparDigitos(a.receita)), a.descricao)

    // previsões por (conta12|fonte)
    const fontes = await getJson<FonteDto[]>(`/api/receitas/fonte-recursos?entidade=${cfg.portal}&exercicio=${ANO}`, { entidade: cfg.portal, exercicio: String(ANO) })
    const previsoes = new Map<string, { previsto: number; arrecadado: number }>()
    const fontesUsadas = new Set<string>()
    for (const f of fontes) {
      const det = await getJson<DetalheDto[]>(
        `/api/receitas/fonte-recursos/detalhes?entidade=${cfg.portal}&exercicio=${ANO}&fonteRecurso=${f.receita}&dataInicial=${ANO}-01-01&dataFinal=${ATE}`,
        { entidade: cfg.portal, exercicio: String(ANO) },
      )
      const codigos = det.map((d) => d.receita)
      for (const d of det) {
        // folha = ninguém a estende
        const folha = !codigos.some((c) => c !== d.receita && c.startsWith(d.receita) && c.length > d.receita.length)
        if (!folha) continue
        if (!(d.valorArrecadado || d.valorOrcadoAtualizado)) continue
        const conta = pad12(d.receita)
        if (!descPorConta.has(conta)) descPorConta.set(conta, d.descricao)
        const k = `${conta}|${f.receita}`
        const cur = previsoes.get(k) ?? { previsto: 0, arrecadado: 0 }
        cur.previsto += d.valorOrcadoAtualizado || 0
        cur.arrecadado += d.valorArrecadado || 0
        previsoes.set(k, cur)
        fontesUsadas.add(f.receita)
      }
    }
    const somaArrec = cent([...previsoes.values()].reduce((s, v) => s + v.arrecadado, 0))

    // guard: dashboard
    const dash = await getJson<DashDto[]>(`/api/dashboard/arrecadacao-despesa?exercicio=${ANO}`, { entidade: cfg.portal, exercicio: String(ANO) })
    const mesLimite = parseInt(ATE.slice(5, 7), 10)
    const dashArrec = cent(dash.slice(0, mesLimite).reduce((s, m) => s + (m.valorArrecadado || 0), 0))
    const okGuard = Math.abs(somaArrec - dashArrec) <= 200 // R$ 2,00 (folhas × dashboard podem ter arredondamento)
    console.log(`  ${previsoes.size} previsões (natureza×fonte) · Σ arrec ${reais(somaArrec)} × dashboard ${reais(dashArrec)} ${okGuard ? '✓' : '✗ DIVERGE'}`)
    if (!okGuard) {
      console.error('  ABORTADO: guard do dashboard falhou.')
      process.exit(1)
    }
    if (previsoes.size === 0) {
      console.log('  (sem receita própria — nada a importar)')
      continue
    }
    if (!APPLY) continue

    await prisma.$transaction(
      async (tx) => {
        // 1) fontes ausentes
        const fontesDb = new Set(
          (await tx.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true } })).map((f) => f.codigo.trim()),
        )
        const fontesACriar = [...fontesUsadas].filter((c) => !fontesDb.has(c))
        if (fontesACriar.length)
          await tx.fonteRecursoEntidade.createMany({
            data: fontesACriar.map((codigo) => ({ entidadeId: entidade.id, ano: ANO, codigo, nomenclatura: `Fonte ${codigo} (receita portal)`, vinculada: codigo !== '1000' && codigo !== '1001', origem: 'DESDOBRAMENTO' as const })),
          })
        const fontesId = new Map(
          (await tx.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { id: true, codigo: true } })).map((f) => [f.codigo.trim(), f.id]),
        )

        // 2) contas-receita: cria a cadeia de desdobramentos ausentes (incl. cat-7)
        const contasDb = new Map(
          (await tx.contaReceitaEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { id: true, codigo: true, admiteMovimento: true } })).map((c) => [c.codigo, c]),
        )
        const novas = new Map<string, { codigo: string; nivel: number; folha: boolean }>()
        for (const chave of previsoes.keys()) {
          let atual = chave.split('|')[0]!
          let folha = true
          while (!contasDb.has(atual)) {
            const ja = novas.get(atual)
            if (ja) {
              if (!folha) ja.folha = false
              break
            }
            novas.set(atual, { codigo: atual, nivel: nivelReceita(atual), folha })
            const pai = paiReceita(atual)
            if (pai === atual) break // categoria-raiz sem pai
            atual = pai
            folha = false
          }
        }
        // criar de cima p/ baixo (pai antes do filho)
        for (const nova of [...novas.values()].sort((a, b) => a.nivel - b.nivel)) {
          const criada = await tx.contaReceitaEntidade.create({
            data: {
              entidadeId: entidade.id,
              ano: ANO,
              codigo: nova.codigo,
              descricao: descPorConta.get(nova.codigo) ?? `Receita ${nova.codigo}`,
              nivel: nova.nivel,
              admiteMovimento: nova.folha,
              origem: 'DESDOBRAMENTO',
            },
            select: { id: true, codigo: true, admiteMovimento: true },
          })
          contasDb.set(criada.codigo, criada)
        }
        // pais analíticos que ganharam filho → sintéticos
        const paisSinteticos = new Set<string>()
        for (const nova of novas.values()) {
          const pai = contasDb.get(paiReceita(nova.codigo))
          if (pai?.admiteMovimento) paisSinteticos.add(pai.codigo)
        }
        if (paisSinteticos.size)
          await tx.contaReceitaEntidade.updateMany({ where: { entidadeId: entidade.id, ano: ANO, codigo: { in: [...paisSinteticos] } }, data: { admiteMovimento: false } })

        // 3) previsões (idempotente: recria as do orçamento)
        await tx.previsaoReceita.deleteMany({ where: { orcamentoId: orcamento.id } })
        const contasId = new Map([...contasDb].map(([codigo, c]) => [codigo, c.id]))
        await tx.previsaoReceita.createMany({
          data: [...previsoes].map(([k, v]) => {
            const [conta, fonte] = k.split('|')
            return {
              orcamentoId: orcamento.id,
              contaReceitaEntidadeId: contasId.get(conta)!,
              fonteRecursoEntidadeId: fontesId.get(fonte)!,
              valorPrevisto: (v.previsto).toFixed(2),
              valorArrecadado: (v.arrecadado).toFixed(2),
            }
          }),
        })
        console.log(`  ✓ gravado: ${novas.size} contas novas · ${previsoes.size} previsões · Σ arrecadado ${reais(somaArrec)}`)
      },
      { timeout: 180000 },
    )

    // verificação pós-apply
    const agg = await prisma.previsaoReceita.aggregate({ where: { orcamentoId: orcamento.id }, _sum: { valorArrecadado: true } })
    const gravado = cent(Number(agg._sum.valorArrecadado ?? 0))
    console.log(`  Σ arrecadado no banco: ${reais(gravado)} ${gravado === somaArrec ? '✓' : '≠'}`)
  }

  console.log(`\n${APPLY ? 'Concluído.' : 'Dry-run — nada gravado. Rode com --apply.'}\n`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('FALHOU:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
