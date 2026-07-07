/**
 * LOA 2026 das DEMAIS ENTIDADES de Maringá (Câmara, Maringá Previdência, AMR,
 * IPPLAM, IAM) a partir do QDD oficial (Anexo XXIV da Lei 12.100/2025 —
 * data/qdd_loa_2026_maringa.csv, extraído do PDF e validado ao centavo).
 *
 * Motivação: o RGF/DCL "consolidado" morava só na Prefeitura; para a
 * consolidação municipal de verdade cada entidade precisa do próprio
 * orçamento (o refino MDF da DCL quer o RPPS na entidade certa).
 *
 * Mapa órgão QDD → entidade (validado: Σ 739,4mi; QDD total 3.582,0 −
 * 739,4 = 2.842,6 = Despesa LOA da Prefeitura ✓):
 *   01 → Câmara do Município de Maringá        (existe)
 *   31 → Maringá Previdência                    (existe)
 *   50 → Agência Maringaense de Regulação (AMR) (existe)
 *   60 → IPPLAM                                 (CRIA — ADM_INDIRETA)
 *   61 → IAM — Instituto Ambiental de Maringá   (CRIA — ADM_INDIRETA)
 *
 * O que cria por entidade (na transação): fontes ausentes (QDD, origem
 * DESDOBRAMENTO), Órgão + UO (codigo = "orgao.unidade"), Programas
 * (nome-placeholder "Programa NNNN" — o QDD não traz o nome do programa) e
 * Ações (nome = dotacao_nome), Orcamento APROVADO e DotacaoDespesa com as
 * 7 dimensões e FONTE REAL. Funções/subfunções são globais (já existem);
 * contas resolvem por natureza+'.00.00' no plano da entidade (cópia do
 * modelo — IAM/IPPLAM ganham o plano via RessincronizadorModelo).
 *
 * Receita/previsões das entidades ficam FORA (fase futura; telas mostram
 * receita vazia sem quebrar). Consórcios e SBMG fora do escopo.
 *
 * Invariantes (aborta se quebrar): Σ dotações por órgão = Σ QDD ao centavo;
 * toda natureza/fonte/função/subfunção resolvida; Orcamento 2026 não pode
 * já existir (sem --substituir).
 *
 * Rodar: npx tsx scripts/importar_orcamento_entidades_2026.ts [--apply] [--substituir]
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { EntidadeService } from '../src/services/entidades.js'

const APPLY = process.argv.includes('--apply')
const SUBSTITUIR = process.argv.includes('--substituir')
const ANO = 2026
const CSV = 'data/qdd_loa_2026_maringa.csv'

const ENTIDADES: { orgao: string; nome: string; tipo: 'CAMARA' | 'ADM_INDIRETA'; buscar: RegExp }[] = [
  { orgao: '01', nome: 'Câmara do Município de Maringá', tipo: 'CAMARA', buscar: /c[âa]mara/i },
  { orgao: '31', nome: 'Maringá Previdência', tipo: 'ADM_INDIRETA', buscar: /previd[êe]ncia/i },
  { orgao: '50', nome: 'Agência Maringaense de Regulação (AMR)', tipo: 'ADM_INDIRETA', buscar: /regula[çc][ãa]o/i },
  { orgao: '60', nome: 'IPPLAM - Instituto de Pesquisa e Planejamento Urbano de Maringá', tipo: 'ADM_INDIRETA', buscar: /IPPLAM/i },
  { orgao: '61', nome: 'Instituto Ambiental de Maringá - IAM', tipo: 'ADM_INDIRETA', buscar: /ambiental/i },
]

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const reais = (c: number): string =>
  (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cent = (s: string): number => Math.round(parseFloat(s) * 100)

type Linha = {
  orgao: string
  unidade: string
  funcao: string
  subfuncao: string
  programa: string
  acao: string
  dotacaoNome: string
  natureza: string
  fonte: string
  fonteNome: string
  centavos: number
}

function lerCsv(): Linha[] {
  const linhas = readFileSync(CSV, 'utf8').replace(/\r/g, '').trim().split('\n')
  const cab = linhas[0].split(',')
  const idx = (c: string) => {
    const i = cab.indexOf(c)
    if (i < 0) throw new Error(`coluna ${c} ausente no CSV`)
    return i
  }
  // parser CSV com campos entre aspas (dotacao_nome pode conter vírgula)
  const parse = (l: string): string[] => {
    const campos: string[] = []
    let cur = ''
    let dentro = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (ch === '"') {
        if (dentro && l[i + 1] === '"') {
          cur += '"'
          i++
        } else dentro = !dentro
      } else if (ch === ',' && !dentro) {
        campos.push(cur)
        cur = ''
      } else cur += ch
    }
    campos.push(cur)
    return campos
  }
  const out: Linha[] = []
  for (const l of linhas.slice(1)) {
    const c = parse(l)
    out.push({
      orgao: c[idx('orgao')],
      unidade: c[idx('unidade')],
      funcao: c[idx('funcao')],
      subfuncao: c[idx('subfuncao')],
      programa: c[idx('programa')],
      acao: c[idx('acao')],
      dotacaoNome: c[idx('dotacao_nome')],
      natureza: c[idx('natureza')],
      fonte: c[idx('fonte')],
      fonteNome: c[idx('fonte_nome')],
      centavos: cent(c[idx('valor')]),
    })
  }
  return out
}

function tipoPrograma(nome: string): 'FINALISTICO' | 'GESTAO' | 'OPERACOES_ESPECIAIS' {
  if (/APOIO ADMINISTRATIVO|MANUTEN/i.test(nome)) return 'GESTAO'
  return 'FINALISTICO'
}
function tipoAcao(codigo: string): 'PROJETO' | 'ATIVIDADE' | 'OPERACAO_ESPECIAL' {
  if (codigo.startsWith('1')) return 'PROJETO'
  if (codigo.startsWith('2')) return 'ATIVIDADE'
  return 'OPERACAO_ESPECIAL'
}

async function main() {
  console.log(`\n═══ LOA ${ANO} das demais entidades de Maringá (${APPLY ? 'APPLY' : 'dry-run'}) ═══\n`)
  const todas = lerCsv()
  const porOrgao = new Map<string, Linha[]>()
  for (const l of todas) {
    if (!ENTIDADES.some((e) => e.orgao === l.orgao)) continue
    const arr = porOrgao.get(l.orgao) ?? []
    arr.push(l)
    porOrgao.set(l.orgao, arr)
  }

  const municipio = await prisma.municipio.findFirst({
    where: { nome: { contains: 'Maring', mode: 'insensitive' }, estado: { is: { sigla: 'PR' } } },
    select: { id: true },
  })
  if (!municipio) throw new Error('município de Maringá/PR não encontrado')

  // funções/subfunções globais (pré-checagem fora da transação)
  const funcoes = new Map((await prisma.funcao.findMany({ select: { id: true, codigo: true } })).map((f) => [f.codigo, f.id]))
  const subfuncoes = new Map((await prisma.subfuncao.findMany({ select: { id: true, codigo: true } })).map((f) => [f.codigo, f.id]))

  let criadasEntidades = 0
  for (const cfg of ENTIDADES) {
    const linhas = porOrgao.get(cfg.orgao) ?? []
    const alvo = linhas.reduce((s, l) => s + l.centavos, 0)
    console.log(`\n▶ órgão ${cfg.orgao} — ${cfg.nome}: ${linhas.length} linhas · Σ QDD ${reais(alvo)}`)
    if (!linhas.length) throw new Error(`órgão ${cfg.orgao} sem linhas no QDD`)

    // ── entidade (cria IAM/IPPLAM se faltar)
    let entidade = await prisma.entidade.findFirst({
      where: { municipioId: municipio.id, nome: { contains: cfg.buscar.source.replace(/\\|\[.*?\]|\(.*?\)/g, '').slice(0, 6), mode: 'insensitive' } },
      select: { id: true, nome: true },
    })
    // busca robusta: por regex em memória (nomes têm acentos/siglas)
    if (!entidade) {
      const cands = await prisma.entidade.findMany({ where: { municipioId: municipio.id }, select: { id: true, nome: true } })
      entidade = cands.find((c) => cfg.buscar.test(c.nome)) ?? null
    }
    if (!entidade) {
      console.log(`  entidade não existe → ${APPLY ? 'CRIANDO' : 'criaria'} "${cfg.nome}" (${cfg.tipo}) via EntidadesService (onboarding copia os planos do modelo)`)
      if (APPLY) {
        const nova = await new EntidadeService(prisma).criar({ municipioId: municipio.id, nome: cfg.nome, tipo: cfg.tipo, ano: ANO })
        entidade = { id: nova.id, nome: nova.nome }
        criadasEntidades++
      } else {
        continue // dry-run: sem entidade não dá pra simular o resto; o resumo abaixo cobre
      }
    }

    // ── pré-resoluções (fora da transação, só leitura)
    const contas = new Map(
      (await prisma.contaDespesaEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { id: true, codigo: true } })).map(
        (c) => [c.codigo, c.id],
      ),
    )
    if (contas.size === 0) {
      console.error(`  ABORTADO: "${entidade.nome}" sem plano de despesa ${ANO} — onboarding não copiou o modelo?`)
      process.exit(1)
    }

    // subfunções fora do catálogo (ex.: 997 Reserva de Contingência do RPPS,
    // convenção TCE) são criadas sob a própria função da linha do QDD.
    const NOMES_SUBFUNCAO: Record<string, string> = { '997': 'Reserva de Contingência do RPPS' }
    const subfuncoesACriar = new Map<string, string>() // codigo → funcaoCodigo
    const problemas: string[] = []
    for (const l of linhas) {
      if (!funcoes.has(l.funcao)) problemas.push(`função ${l.funcao}`)
      else if (!subfuncoes.has(l.subfuncao)) subfuncoesACriar.set(l.subfuncao, l.funcao)
      if (contas.size && !contas.has(`${l.natureza}.00.00`)) problemas.push(`conta ${l.natureza}.00.00`)
    }
    if (problemas.length) {
      console.error(`  ABORTADO: dimensões sem resolução: ${[...new Set(problemas)].slice(0, 8).join(', ')}`)
      process.exit(1)
    }
    if (subfuncoesACriar.size) {
      console.log(`  subfunções novas no catálogo global: ${[...subfuncoesACriar.keys()].join(', ')}`)
      if (APPLY)
        for (const [codigo, funcaoCodigo] of subfuncoesACriar) {
          const nova = await prisma.subfuncao.create({
            data: { codigo, nome: NOMES_SUBFUNCAO[codigo] ?? `Subfunção ${codigo} (QDD)`, funcaoId: funcoes.get(funcaoCodigo)! },
            select: { id: true },
          })
          subfuncoes.set(codigo, nova.id)
        }
    }

    const orcExistente = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId: entidade.id, ano: ANO } }, select: { id: true } })
    if (orcExistente && !SUBSTITUIR) {
      console.error(`  ABORTADO: "${entidade.nome}" já tem Orcamento ${ANO} (use --substituir).`)
      process.exit(1)
    }

    const fontesQdd = new Map(linhas.map((l) => [l.fonte, l.fonteNome]))
    const fontesDb = new Set(
      (await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true } })).map((f) =>
        f.codigo.trim(),
      ),
    )
    const fontesACriar = [...fontesQdd].filter(([c]) => !fontesDb.has(c))
    const uos = new Map<string, string>() // "orgao.unidade" → nome (da 1ª dotação vista)
    for (const l of linhas) if (!uos.has(`${l.orgao}.${l.unidade}`)) uos.set(`${l.orgao}.${l.unidade}`, `${cfg.nome} — UO ${l.unidade}`)
    const programas = new Set(linhas.map((l) => l.programa))
    const acoes = new Map(linhas.map((l) => [`${l.programa}|${l.acao}`, l.dotacaoNome]))

    console.log(
      `  ${APPLY ? 'gravando' : 'criaria'}: ${fontesACriar.length} fontes · 1 órgão · ${uos.size} UO(s) · ${programas.size} programas · ${acoes.size} ações · ${linhas.length} dotações`,
    )
    if (!APPLY) continue

    await prisma.$transaction(
      async (tx) => {
        if (orcExistente) await tx.orcamento.delete({ where: { id: orcExistente.id } })

        if (fontesACriar.length)
          await tx.fonteRecursoEntidade.createMany({
            data: fontesACriar.map(([codigo, nomenclatura]) => ({
              entidadeId: entidade!.id,
              ano: ANO,
              codigo,
              nomenclatura,
              vinculada: codigo !== '1000' && codigo !== '1001',
              origem: 'DESDOBRAMENTO' as const,
            })),
          })
        const fontesId = new Map(
          (await tx.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade!.id, ano: ANO }, select: { id: true, codigo: true } })).map(
            (f) => [f.codigo.trim(), f.id],
          ),
        )

        const orgao = await tx.orgao.upsert({
          where: { entidadeId_codigo: { entidadeId: entidade!.id, codigo: cfg.orgao } },
          create: { entidadeId: entidade!.id, codigo: cfg.orgao, nome: cfg.nome },
          update: {},
          select: { id: true },
        })
        const uosId = new Map<string, string>()
        for (const [codigo, nome] of uos) {
          const uo = await tx.unidadeOrcamentaria.upsert({
            where: { entidadeId_codigo: { entidadeId: entidade!.id, codigo } },
            create: { entidadeId: entidade!.id, codigo, nome, orgaoId: orgao.id },
            update: { orgaoId: orgao.id },
            select: { id: true },
          })
          uosId.set(codigo, uo.id)
        }

        const programasId = new Map<string, string>()
        for (const p of programas) {
          const nome = `Programa ${p} (QDD — nome não publicado no Anexo XXIV)`
          const prog = await tx.programa.upsert({
            where: { entidadeId_ano_codigo: { entidadeId: entidade!.id, ano: ANO, codigo: p } },
            create: { entidadeId: entidade!.id, ano: ANO, codigo: p, nome, tipo: tipoPrograma(nome) },
            update: {},
            select: { id: true },
          })
          programasId.set(p, prog.id)
        }
        const acoesId = new Map<string, string>()
        for (const [chave, nome] of acoes) {
          const [p, a] = chave.split('|')
          const acao = await tx.acao.upsert({
            where: { programaId_codigo: { programaId: programasId.get(p)!, codigo: a } },
            create: { programaId: programasId.get(p)!, codigo: a, nome, tipo: tipoAcao(a) },
            update: {},
            select: { id: true },
          })
          acoesId.set(chave, acao.id)
        }

        const orc = await tx.orcamento.create({
          data: {
            entidadeId: entidade!.id,
            ano: ANO,
            status: 'APROVADO',
            leiNumero: '12.100/2025',
            observacoes:
              `Importado do QDD oficial (Anexo XXIV da LOA, órgão ${cfg.orgao}) em 2026-07-07. ` +
              'Fonte real por dotação. Nomes de PROGRAMA são placeholder (o Anexo XXIV não os publica). ' +
              'Receita/previsões desta entidade ainda não importadas.',
          },
          select: { id: true },
        })

        // dotações agregadas pela chave única (QDD pode repetir a mesma 7-tupla)
        const agreg = new Map<string, { l: Linha; centavos: number }>()
        for (const l of linhas) {
          const k = `${l.orgao}.${l.unidade}|${l.funcao}|${l.subfuncao}|${l.programa}|${l.acao}|${l.natureza}|${l.fonte}`
          const cur = agreg.get(k)
          if (cur) cur.centavos += l.centavos
          else agreg.set(k, { l, centavos: l.centavos })
        }
        await tx.dotacaoDespesa.createMany({
          data: [...agreg.values()].map(({ l, centavos }) => ({
            orcamentoId: orc.id,
            unidadeOrcamentariaId: uosId.get(`${l.orgao}.${l.unidade}`)!,
            funcaoId: funcoes.get(l.funcao)!,
            subfuncaoId: subfuncoes.get(l.subfuncao)!,
            programaId: programasId.get(l.programa)!,
            acaoId: acoesId.get(`${l.programa}|${l.acao}`)!,
            contaDespesaEntidadeId: contas.get(`${l.natureza}.00.00`)!,
            fonteRecursoEntidadeId: fontesId.get(l.fonte)!,
            valorAutorizado: centavos / 100,
          })),
        })

        const soma = await tx.dotacaoDespesa.aggregate({ where: { orcamentoId: orc.id }, _sum: { valorAutorizado: true } })
        const gravado = Math.round(Number(soma._sum.valorAutorizado ?? 0) * 100)
        if (gravado !== alvo) throw new Error(`Σ gravado ${reais(gravado)} ≠ Σ QDD ${reais(alvo)} — rollback`)
        console.log(`  ✓ gravado: ${agreg.size} dotações · Σ ${reais(gravado)} = QDD ao centavo`)
      },
      { timeout: 180000 },
    )
  }

  if (!APPLY) {
    const total = [...porOrgao.values()].flat().reduce((s, l) => s + l.centavos, 0)
    console.log(`\nΣ geral das 5 entidades no QDD: ${reais(total)} (esperado ≈ 739,4mi)`)
    console.log('Dry-run — nada gravado. Rode com --apply.\n')
  } else if (criadasEntidades) {
    console.log(`\n⚠️ ${criadasEntidades} entidade(s) criada(s) — rode: npx tsx scripts/conceder_acesso_total.ts marco@teste.com`)
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('FALHOU:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
