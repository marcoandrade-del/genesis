/**
 * REPASSES RECEBIDOS (evento 900) das entidades transfer-financiadas dos municípios
 * Elotech importados (Cianorte/Naviraí/Vilhena/Sarandi) — AUTOMATIZADO do portal.
 *
 * Câmaras e fundos/autarquias recebem repasse do Executivo (duodécimo/cobertura):
 * NÃO é receita orçamentária → evento 900 (D Caixa 1.1.1.1.1.30 / C VPA 4.5.1.1.2.02
 * REPASSE RECEBIDO), cc=fonte. Fonte 9999 (o portal não discrimina a fonte do
 * repasse, igual à despesa). Fonte do valor: `GET /api/repasses?tipo=R` (header
 * entidade=idPortal), Σ `valorLancado` = recebido YTD. Reusa as configs do conversor.
 *
 * PULA a Prefeitura (tipo E, que CONCEDE) e o RPPS (tipo R — o aporte previdenciário
 * tem tratamento próprio; precedente Maringá). Idempotente por (entidade, data).
 *
 *   npx tsx scripts/importar_repasses_elotech.ts <cianorte|navirai|vilhena|sarandi|todos> [--apply]
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import type { MunicipioConfig } from '../src/conversor/nucleo/tipos.js'
import { TransferenciasFinanceirasService } from '../src/services/transferencias-financeiras.js'
import { CONTAS_EVENTO } from '../src/services/motor-eventos-receita.js'
import { cianortePr } from '../src/conversor/municipios/cianorte-pr.js'
import { naviraiMs } from '../src/conversor/municipios/navirai-ms.js'
import { vilhenaRo } from '../src/conversor/municipios/vilhena-ro.js'
import { sarandiPr } from '../src/conversor/municipios/sarandi-pr.js'

const CONFIGS: Record<string, MunicipioConfig> = { cianorte: cianortePr, navirai: naviraiMs, vilhena: vilhenaRo, sarandi: sarandiPr }
const FONTE = '9999'
const DATA = '2026-06-30'
const CAIXA = CONTAS_EVENTO.caixaArrecadacao
const VPA = CONTAS_EVENTO.vpaRepasseRecebido

const APPLY = process.argv.includes('--apply')
const alvo = (process.argv[2] ?? '').toLowerCase()
const escolhidos = alvo === 'todos' ? Object.values(CONFIGS) : CONFIGS[alvo] ? [CONFIGS[alvo]!] : []
if (!escolhidos.length) {
  console.error(`Uso: npx tsx scripts/importar_repasses_elotech.ts <${Object.keys(CONFIGS).join('|')}|todos> [--apply]`)
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (d: Prisma.Decimal) => Number(d).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** tipo do portal por idPortal (E=exec, L=câmara, R=rpps, A/D=fundo/autarquia). */
async function tiposPortal(base: string): Promise<Map<string, string>> {
  const res = await fetch(`${base}/api/entidades`, { headers: { exercicio: '2026' } })
  const d = (await res.json()) as { id: number; tipo?: string }[]
  const rows = Array.isArray(d) ? d : ((d as { content?: { id: number; tipo?: string }[] }).content ?? [])
  return new Map(rows.map((e) => [String(e.id), e.tipo ?? '?']))
}

async function repasseLancado(base: string, idPortal: string): Promise<Prisma.Decimal> {
  const res = await fetch(`${base}/api/repasses?tipo=R&mesInicial=01&mesFinal=12`, { headers: { entidade: idPortal, exercicio: '2026' } })
  if (!res.ok) throw new Error(`portal HTTP ${res.status}`)
  const d = (await res.json()) as { valorLancado?: number }[] | { content?: { valorLancado?: number }[] }
  const rows = Array.isArray(d) ? d : (d.content ?? [])
  return new Prisma.Decimal(rows.reduce((s, r) => s + (r.valorLancado ?? 0), 0).toFixed(2))
}

async function main() {
  const usuario = await prisma.usuario.findFirstOrThrow({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  const service = new TransferenciasFinanceirasService(prisma)
  let totalGeral = new Prisma.Decimal(0)

  for (const cfg of escolhidos) {
    console.log(`\n═══ Repasses (evento 900) — ${cfg.nome}/${cfg.uf} ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
    const base = cfg.portalUrl!
    const tipos = await tiposPortal(base)

    for (const ent of cfg.entidades) {
      const idPortal = ent.params?.idPortal
      if (!idPortal) continue
      const tp = tipos.get(idPortal) ?? '?'
      if (tp === 'E' || tp === 'R') continue // Prefeitura concede · RPPS = aporte (fora)

      const valor = await repasseLancado(base, idPortal)
      if (valor.lte(0)) continue

      const e = await prisma.entidade.findFirst({ where: { nome: ent.nome, municipio: { is: { nome: cfg.nome, estado: { is: { sigla: cfg.uf } } } } }, select: { id: true, nome: true } })
      if (!e) { console.log(`  ${ent.nome}: entidade não encontrada — pulando`); continue }

      // pré-validação (caixa/VPA MOV + fonte)
      const contas = new Map((await prisma.contaContabilEntidade.findMany({ where: { entidadeId: e.id, ano: cfg.ano, codigo: { in: [CAIXA, VPA] } }, select: { codigo: true, admiteMovimento: true } })).map((c) => [c.codigo, c.admiteMovimento]))
      const temFonte = await prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId: e.id, ano: cfg.ano, codigo: FONTE }, select: { id: true } })
      if (contas.get(CAIXA) !== true || contas.get(VPA) !== true || !temFonte) {
        console.log(`  ${e.nome} [${tp}]: SEM caixa/VPA/fonte ${FONTE} — pulando`)
        continue
      }

      const jaExiste = await prisma.transferenciaFinanceira.findFirst({ where: { entidadeId: e.id, data: new Date(DATA) }, select: { id: true } })
      console.log(`  ${e.nome} [${tp}]: repasse R$ ${reais(valor)}${jaExiste ? ' (já lançado — idempotente)' : ''}`)
      if (jaExiste || !APPLY) continue

      await service.registrar({ entidadeId: e.id, data: DATA, valor: valor.toFixed(2), fonteCodigo: FONTE, historico: `Transferência financeira recebida do Município (repasse jan–jun/${cfg.ano})`, criadoPorId: usuario.id })
      totalGeral = totalGeral.plus(valor)
      console.log(`    ✓ gravado`)
    }
  }
  console.log(APPLY ? `\n[apply] Σ repasses gravados: R$ ${reais(totalGeral)}` : '\nDRY-RUN: nada gravado. Rode com --apply.')
}
main().catch((e) => { console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); await pool.end() })
