/**
 * MATERIALIZA a execução da despesa de Paranaguá/PR (exercício 2026) a partir
 * dos dados abertos do PIT/TCE-PR (XML nível-empenho do SIM-AM).
 *
 * Diferente da captura do portal Elotech (sincronizacao-portal.despesaMes), que
 * RATEIA o valor entre as fontes da dotação, o PIT traz a FONTE EXATA por
 * empenho — então NÃO há rateio: agregamos os empenhos pela CHAVE DE DOTAÇÃO
 * completa (UO × Função × Subfunção × Programa × Ação × ContaDespesa[natureza] ×
 * Fonte) somando vlEmpenho/vlLiquidacao/vlPagamento e gravamos um empenho de
 * captura (CAP-*) + MovimentoEmpenho por dotação, espelhando o writer canônico.
 *
 * Fonte dos dados: https://pit.tce.pr.gov.br/Arquivos/{ano}/{ano}_{ibge6}_Despesa.zip
 * (Empenho.xml: self-closing, atributos; UTF-8 com BOM — apesar da declaração
 * "iso-8859-1" do gerador, os bytes são UTF-8). vlLiquidacao/vlPagamento já vêm
 * acumulados/líquidos no nível do empenho.
 *
 * Escopo: as 3 entidades onboardadas do município (Prefeitura, Câmara,
 * Previdência). Ignora CISLIPA e a autarquia de água (regionais, fora do escopo).
 *
 * DRY-RUN por padrão (nada grava). --apply grava numa transação por entidade.
 *
 * Rodar (da raiz, ESM):
 *   npx tsx scripts/importar_execucao_pit_paranagua.ts \
 *     [--xml <Empenho.xml>] [--zip <Despesa.zip>] [--ano 2026] [--ibge 411820]
 *     [--apply]
 */

import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

// ── args ─────────────────────────────────────────────────────────────────────
function arg(nome: string, padrao: string): string {
  const i = process.argv.indexOf(nome)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : padrao
}
const ANO = parseInt(arg('--ano', '2026'), 10)
const IBGE6 = arg('--ibge', '411820')
const ZIP_ARG = arg('--zip', '')
const XML_ARG = arg('--xml', '')
const APPLY = process.argv.includes('--apply')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// centavos p/ não acumular erro de float
const cent = (s: string | undefined): number => Math.round(parseFloat((s || '0').trim() || '0') * 100)
const reais = (c: number): string =>
  (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── DE/PARA das entidades: nmEntidade (PIT) → seletor da entidade no banco ─────
// Casamos a entidade do banco pelo município Paranaguá/PR + tipo (há uma de cada).
type TipoEnt = 'PREFEITURA' | 'CAMARA' | 'ADM_INDIRETA'
const DE_PARA_ENTIDADE: { pit: string; tipo: TipoEnt; nomeBanco: string }[] = [
  { pit: 'MUNICÍPIO DE PARANAGUÁ', tipo: 'PREFEITURA', nomeBanco: 'Prefeitura' },
  { pit: 'CÂMARA MUNICIPAL DE PARANAGUÁ', tipo: 'CAMARA', nomeBanco: 'Câmara' },
  { pit: 'PARANAGUÁ PREVIDÊNCIA', tipo: 'ADM_INDIRETA', nomeBanco: 'Previdência' },
]

// alvos de validação (Σ vlEmpenho em centavos) — o dry-run tem que bater
const ALVO_EMP: Record<string, number> = {
  'MUNICÍPIO DE PARANAGUÁ': 47467197649,
  'PARANAGUÁ PREVIDÊNCIA': 1940129113,
  'CÂMARA MUNICIPAL DE PARANAGUÁ': 1037285382,
}
const ALVO_N: Record<string, number> = {
  'MUNICÍPIO DE PARANAGUÁ': 4756,
  'PARANAGUÁ PREVIDÊNCIA': 392,
  'CÂMARA MUNICIPAL DE PARANAGUÁ': 346,
}

// ── 1. obter o Empenho.xml ─────────────────────────────────────────────────────
async function obterXml(): Promise<string> {
  const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)
  if (XML_ARG) {
    console.log(`XML local: ${XML_ARG}`)
    return stripBom(readFileSync(XML_ARG, 'utf-8'))
  }
  let zipBuf: Buffer
  if (ZIP_ARG) {
    console.log(`ZIP local: ${ZIP_ARG}`)
    zipBuf = readFileSync(ZIP_ARG)
  } else {
    const url = `https://pit.tce.pr.gov.br/Arquivos/${ANO}/${ANO}_${IBGE6}_Despesa.zip`
    const cache = join(tmpdir(), `pit_${ANO}_${IBGE6}_Despesa.zip`)
    if (existsSync(cache)) {
      console.log(`ZIP em cache: ${cache}`)
      zipBuf = readFileSync(cache)
    } else {
      console.log(`Baixando ${url} ...`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`)
      zipBuf = Buffer.from(await res.arrayBuffer())
      writeFileSync(cache, zipBuf)
      console.log(`  ${(zipBuf.length / 1e6).toFixed(1)} MB (cache: ${cache})`)
    }
  }
  const zip = await JSZip.loadAsync(zipBuf)
  const nomeXml = Object.keys(zip.files).find((n) => /_Empenho\.xml$/.test(n))
  if (!nomeXml) throw new Error(`Empenho.xml não encontrado no ZIP (${Object.keys(zip.files).join(', ')})`)
  return stripBom(await zip.files[nomeXml]!.async('string')) // JSZip decodifica UTF-8
}

// ── 2. parse dos <Empenho .../> (self-closing, atributos) ─────────────────────
type Attrs = Record<string, string>
function* registros(xml: string): Generator<Attrs> {
  for (const m of xml.matchAll(/<Empenho ([^>]*?)\/>/g)) {
    const attrs: Attrs = {}
    for (const a of m[1]!.matchAll(/([A-Za-z]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!
    yield attrs
  }
}

// chave de dotação e agregados por entidade
type Agregado = { emp: number; liq: number; pag: number }
type Dotacao = {
  uoCod: string
  uoNome: string
  orgaoNome: string
  funcao: string
  funcaoNome: string
  subfuncao: string
  subfuncaoNome: string
  programa: string
  acao: string
  acaoNome: string
  natureza: string // "3.1.90.01.01.00"
  fonte: string
  ag: Agregado
  saldoAntMax: number // maior vlSaldoAntDotacao visto (base de valorAutorizado se criar)
}

function classificarPorEntidade(xml: string) {
  const porEntidade = new Map<string, { n: number; emp: number; dots: Map<string, Dotacao> }>()
  for (const r of registros(xml)) {
    const ent = r.nmEntidade ?? ''
    let bucket = porEntidade.get(ent)
    if (!bucket) porEntidade.set(ent, (bucket = { n: 0, emp: 0, dots: new Map() }))
    const emp = cent(r.vlEmpenho)
    const liq = cent(r.vlLiquidacao)
    const pag = cent(r.vlPagamento)
    bucket.n++
    bucket.emp += emp
    // dimensões (trim — vêm com padding do gerador)
    const orgao = (r.cdOrgao || '').trim()
    const unidade = (r.cdUnidade || '').trim()
    const uoCod = `${orgao}.${unidade}`
    const funcao = (r.cdFuncao || '').trim()
    const subfuncao = (r.cdSubFuncao || '').trim()
    const programa = (r.cdPrograma || '').trim()
    const acao = (r.cdProjetoAtividade || '').trim()
    const natureza =
      `${(r.cdCategoriaEconomica || '').trim()}.${(r.cdGrupoNatureza || '').trim()}.` +
      `${(r.cdModalidade || '').trim()}.${(r.cdElemento || '').trim()}.${(r.cdDesdobramento || '').trim()}.00`
    // fonte da DESPESA no padrão PCASP novo (mesmo esquema do catálogo: 500/540/600…)
    const fonte = (r.cdFontePadrao || '').trim()
    const chave = `${uoCod}|${funcao}|${subfuncao}|${programa}|${acao}|${natureza}|${fonte}`
    let d = bucket.dots.get(chave)
    if (!d) {
      d = {
        uoCod,
        uoNome: (r.nmUnidade || '').trim(),
        orgaoNome: (r.nmOrgao || '').trim(),
        funcao,
        funcaoNome: (r.dsFuncao || '').trim(),
        subfuncao,
        subfuncaoNome: (r.dsSubFuncao || '').trim(),
        programa,
        acao,
        acaoNome: (r.dsProjetoAtividade || '').trim(),
        natureza,
        fonte,
        ag: { emp: 0, liq: 0, pag: 0 },
        saldoAntMax: 0,
      }
      bucket.dots.set(chave, d)
    }
    d.ag.emp += emp
    d.ag.liq += liq
    d.ag.pag += pag
    const saldoAnt = cent(r.vlSaldoAntDotacao)
    if (saldoAnt > d.saldoAntMax) d.saldoAntMax = saldoAnt
  }
  return porEntidade
}

// ── 3. resolução das dimensões (espelha importar_orcamento_maringa_2026) ──────
function tipoPrograma(codigo: string): 'FINALISTICO' | 'GESTAO' | 'OPERACOES_ESPECIAIS' {
  if (codigo === '0000' || codigo === '9999') return 'OPERACOES_ESPECIAIS'
  return 'FINALISTICO'
}
function tipoAcao(codigo: string): 'PROJETO' | 'ATIVIDADE' | 'OPERACAO_ESPECIAL' {
  if (codigo.startsWith('1')) return 'PROJETO'
  if (codigo.startsWith('2')) return 'ATIVIDADE'
  return 'OPERACAO_ESPECIAL'
}

async function processarEntidade(pitNome: string, dots: Map<string, Dotacao>, nLidos: number) {
  const dp = DE_PARA_ENTIDADE.find((e) => e.pit === pitNome)
  if (!dp) throw new Error(`Entidade PIT "${pitNome}" sem DE/PARA.`)
  const entidade = await prisma.entidade.findFirst({
    where: {
      tipo: dp.tipo,
      municipio: { is: { nome: 'Paranaguá', estado: { is: { sigla: 'PR' } } } }, // EXATO: não casar "Paranaguá (SICONFI)" (outra sessão)
    },
    select: { id: true, nome: true },
  })
  if (!entidade) throw new Error(`Entidade banco tipo ${dp.tipo} de Paranaguá/PR não encontrada.`)
  const orcamento = await prisma.orcamento.findUnique({
    where: { entidadeId_ano: { entidadeId: entidade.id, ano: ANO } },
    select: { id: true },
  })
  if (!orcamento) throw new Error(`Sem orçamento ${ANO} para ${entidade.nome}.`)

  // catálogos existentes
  const funcoesDb = new Map((await prisma.funcao.findMany()).map((f) => [f.codigo, f.id]))
  const subfuncoesDb = new Map((await prisma.subfuncao.findMany()).map((s) => [s.codigo, s.id]))
  const uosDb = new Map(
    (await prisma.unidadeOrcamentaria.findMany({ where: { entidadeId: entidade.id }, select: { codigo: true, id: true } })).map((u) => [u.codigo, u.id]),
  )
  const programasDb = new Map(
    (await prisma.programa.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true } })).map((p) => [p.codigo, p.id]),
  )
  const acoesDb = new Map(
    (
      await prisma.acao.findMany({
        where: { programa: { entidadeId: entidade.id, ano: ANO } },
        select: { codigo: true, id: true, programa: { select: { codigo: true } } },
      })
    ).map((a) => [`${a.programa.codigo}|${a.codigo}`, a.id]),
  )
  const fontesDb = new Map(
    (await prisma.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true } })).map((f) => [
      f.codigo.trim(),
      f.id,
    ]),
  )
  const contasDb = new Map(
    (await prisma.contaDespesaEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true, admiteMovimento: true } })).map(
      (c) => [c.codigo, c],
    ),
  )

  // resolve a conta de despesa pela natureza (folha; senão cai no elemento .00.00)
  const resolverConta = (natureza: string): { id: string; contaCodigo: string; sintetica: boolean } | null => {
    const folha = contasDb.get(natureza)
    if (folha) return { id: folha.id, contaCodigo: natureza, sintetica: !folha.admiteMovimento }
    const p = natureza.split('.') // cat.grp.mod.ele.des.00
    const elemento = `${p[0]}.${p[1]}.${p[2]}.${p[3]}.00.00`
    const el = contasDb.get(elemento)
    if (el) return { id: el.id, contaCodigo: elemento, sintetica: !el.admiteMovimento }
    return null
  }

  // dimensões a criar
  const funcoesNovas = new Map<string, string>()
  const subfuncoesNovas = new Map<string, { nome: string; funcao: string }>()
  const uosNovas = new Map<string, { nome: string; orgao: string }>()
  const programasNovos = new Map<string, string>()
  const acoesNovas = new Map<string, string>() // "prog|acao" → nome
  const fontesNovas = new Map<string, string>() // codigo → nomenclatura
  const contasNaoResolvidas = new Set<string>()
  let dotSintetica = 0

  for (const d of dots.values()) {
    if (!funcoesDb.has(d.funcao) && !funcoesNovas.has(d.funcao)) funcoesNovas.set(d.funcao, d.funcaoNome || `Função ${d.funcao}`)
    if (!subfuncoesDb.has(d.subfuncao) && !subfuncoesNovas.has(d.subfuncao))
      subfuncoesNovas.set(d.subfuncao, { nome: d.subfuncaoNome || `Subfunção ${d.subfuncao}`, funcao: d.funcao })
    if (!uosDb.has(d.uoCod) && !uosNovas.has(d.uoCod)) uosNovas.set(d.uoCod, { nome: d.uoNome || `Unidade ${d.uoCod}`, orgao: d.orgaoNome })
    if (!programasDb.has(d.programa) && !programasNovos.has(d.programa)) programasNovos.set(d.programa, `Programa ${d.programa}`)
    const chaveAcao = `${d.programa}|${d.acao}`
    if (!acoesDb.has(chaveAcao) && !acoesNovas.has(chaveAcao)) acoesNovas.set(chaveAcao, d.acaoNome || `Ação ${d.acao}`)
    if (!fontesDb.has(d.fonte) && !fontesNovas.has(d.fonte)) fontesNovas.set(d.fonte, `Fonte ${d.fonte} (PIT/TCE-PR)`)
    const conta = resolverConta(d.natureza)
    if (!conta) contasNaoResolvidas.add(d.natureza)
    else if (conta.sintetica) dotSintetica++
  }

  const total: Agregado = { emp: 0, liq: 0, pag: 0 }
  for (const d of dots.values()) {
    total.emp += d.ag.emp
    total.liq += d.ag.liq
    total.pag += d.ag.pag
  }

  // ── relatório da entidade ──
  const alvo = ALVO_EMP[pitNome]
  const okN = ALVO_N[pitNome] === nLidos
  const okEmp = alvo === undefined ? undefined : alvo === total.emp
  console.log(`\n══ ${pitNome}  →  "${entidade.nome}" (${dp.tipo}) ══`)
  console.log(`  empenhos lidos: ${nLidos}${ALVO_N[pitNome] !== undefined ? `  (alvo ${ALVO_N[pitNome]} — ${okN ? 'OK' : 'DIVERGE'})` : ''}`)
  console.log(`  Σ empenhado: R$ ${reais(total.emp)}${alvo !== undefined ? `  (alvo R$ ${reais(alvo)} — ${okEmp ? 'OK ao centavo' : `DIVERGE Δ ${reais(total.emp - alvo)}`})` : ''}`)
  console.log(`  Σ liquidado: R$ ${reais(total.liq)}`)
  console.log(`  Σ pago:      R$ ${reais(total.pag)}`)
  console.log(`  dotações distintas (chave completa): ${dots.size}`)
  console.log(`  dimensões que SERIAM criadas:`)
  console.log(`    funções:    ${funcoesNovas.size}${funcoesNovas.size ? ` [${[...funcoesNovas.keys()].sort().join(' ')}]` : ''}`)
  console.log(`    subfunções: ${subfuncoesNovas.size}${subfuncoesNovas.size ? ` [${[...subfuncoesNovas.keys()].sort().join(' ')}]` : ''}`)
  console.log(`    UOs:        ${uosNovas.size}`)
  console.log(`    programas:  ${programasNovos.size}`)
  console.log(`    ações:      ${acoesNovas.size}`)
  console.log(`    fontes:     ${fontesNovas.size}${fontesNovas.size ? ` [${[...fontesNovas.keys()].sort().join(' ')}]` : ''}`)
  console.log(`  contas de despesa em conta SINTÉTICA (fallback p/ elemento): dotações=${dotSintetica}`)
  if (contasNaoResolvidas.size)
    console.log(`  naturezas SEM conta no plano (nem elemento): ${[...contasNaoResolvidas].join(' ')}`)
  console.log(
    `  fontes do PIT sem par no catálogo (serão CRIADAS origem DESDOBRAMENTO): ${
      fontesNovas.size ? [...fontesNovas.keys()].sort().join(' ') : '(nenhuma)'
    }`,
  )

  if (!APPLY) return { entidade, ok: okN && okEmp !== false }

  // ── GRAVAÇÃO (--apply) ──────────────────────────────────────────────────────
  const usuario = await prisma.usuario.findFirst({ orderBy: { criadoEm: 'asc' }, select: { id: true } })
  if (!usuario) throw new Error('Sem usuário para criadoPorId.')
  let fornecedor = await prisma.fornecedor.findFirst({ where: { razaoSocial: 'CAPTURA PIT/TCE-PR' }, select: { id: true } })
  if (!fornecedor)
    fornecedor = await prisma.fornecedor.create({
      data: { tipoPessoa: 'PJ', razaoSocial: 'CAPTURA PIT/TCE-PR', nomeFantasia: 'Execução materializada do PIT (não é credor real)' },
      select: { id: true },
    })

  const historico = `CAPTURA PIT execução ${ANO}`
  const dataMov = new Date(Date.UTC(ANO, 11, 31))

  await prisma.$transaction(
    async (tx) => {
      // 3a. dimensões que faltam
      for (const [codigo, nome] of funcoesNovas) funcoesDb.set(codigo, (await tx.funcao.create({ data: { codigo, nome }, select: { id: true } })).id)
      for (const [codigo, s] of subfuncoesNovas) {
        const funcaoId = funcoesDb.get(s.funcao)
        if (!funcaoId) throw new Error(`Função ${s.funcao} da subfunção ${codigo} não resolvida.`)
        subfuncoesDb.set(codigo, (await tx.subfuncao.create({ data: { codigo, nome: s.nome, funcaoId }, select: { id: true } })).id)
      }
      if (uosNovas.size)
        await tx.unidadeOrcamentaria.createMany({ data: [...uosNovas].map(([codigo, u]) => ({ entidadeId: entidade.id, codigo, nome: u.nome })) })
      for (const u of await tx.unidadeOrcamentaria.findMany({ where: { entidadeId: entidade.id }, select: { codigo: true, id: true } })) uosDb.set(u.codigo, u.id)
      if (programasNovos.size)
        await tx.programa.createMany({
          data: [...programasNovos].map(([codigo, nome]) => ({ entidadeId: entidade.id, ano: ANO, codigo, nome, tipo: tipoPrograma(codigo) })),
        })
      for (const p of await tx.programa.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true } })) programasDb.set(p.codigo, p.id)
      if (acoesNovas.size)
        await tx.acao.createMany({
          data: [...acoesNovas].map(([chave, nome]) => {
            const [prog, cod] = chave.split('|') as [string, string]
            const programaId = programasDb.get(prog)
            if (!programaId) throw new Error(`Programa ${prog} da ação ${cod} não resolvido.`)
            return { programaId, codigo: cod, nome, tipo: tipoAcao(cod) }
          }),
        })
      for (const a of await tx.acao.findMany({
        where: { programa: { entidadeId: entidade.id, ano: ANO } },
        select: { codigo: true, id: true, programa: { select: { codigo: true } } },
      }))
        acoesDb.set(`${a.programa.codigo}|${a.codigo}`, a.id)
      if (fontesNovas.size)
        await tx.fonteRecursoEntidade.createMany({
          data: [...fontesNovas].map(([codigo, nomenclatura]) => ({
            entidadeId: entidade.id,
            ano: ANO,
            codigo,
            nomenclatura,
            vinculada: codigo !== '000' && codigo !== '500',
            origem: 'DESDOBRAMENTO' as const,
          })),
        })
      for (const f of await tx.fonteRecursoEntidade.findMany({ where: { entidadeId: entidade.id, ano: ANO }, select: { codigo: true, id: true } }))
        fontesDb.set(f.codigo.trim(), f.id)

      // 3b. upsert das dotações + empenho de captura + movimentos (limpa-e-recria)
      await tx.movimentoEmpenho.deleteMany({ where: { entidadeId: entidade.id, historico } })

      let nDotCriadas = 0
      const movRows: {
        entidadeId: string
        empenhoId: string
        tipo: 'EMPENHO' | 'LIQUIDACAO' | 'PAGAMENTO'
        valor: string
        data: Date
        criadoPorId: string
        historico: string
      }[] = []

      // Agrega pela dotação RESOLVIDA (dotacao_unica): naturezas distintas que caem
      // na MESMA conta sintética (fallback elemento .00.00) colapsam numa dotação só
      // — aqui SOMAMOS os agregados; gravar por natureza-crua sobrescreveria (bug).
      type DotKey = {
        orcamentoId: string
        unidadeOrcamentariaId: string
        funcaoId: string
        subfuncaoId: string
        programaId: string
        acaoId: string
        contaDespesaEntidadeId: string
        fonteRecursoEntidadeId: string
      }
      const porDot = new Map<string, { dotKey: DotKey; emp: number; liq: number; pag: number; saldoAntMax: number }>()
      for (const d of dots.values()) {
        const conta = resolverConta(d.natureza)
        if (!conta) throw new Error(`Natureza ${d.natureza} sem conta no plano — não pode gravar.`)
        const dotKey: DotKey = {
          orcamentoId: orcamento.id,
          unidadeOrcamentariaId: uosDb.get(d.uoCod)!,
          funcaoId: funcoesDb.get(d.funcao)!,
          subfuncaoId: subfuncoesDb.get(d.subfuncao)!,
          programaId: programasDb.get(d.programa)!,
          acaoId: acoesDb.get(`${d.programa}|${d.acao}`)!,
          contaDespesaEntidadeId: conta.id,
          fonteRecursoEntidadeId: fontesDb.get(d.fonte)!,
        }
        const sig = `${dotKey.unidadeOrcamentariaId}|${dotKey.funcaoId}|${dotKey.subfuncaoId}|${dotKey.programaId}|${dotKey.acaoId}|${dotKey.contaDespesaEntidadeId}|${dotKey.fonteRecursoEntidadeId}`
        let g = porDot.get(sig)
        if (!g) porDot.set(sig, (g = { dotKey, emp: 0, liq: 0, pag: 0, saldoAntMax: 0 }))
        g.emp += d.ag.emp
        g.liq += d.ag.liq
        g.pag += d.ag.pag
        if (d.saldoAntMax > g.saldoAntMax) g.saldoAntMax = d.saldoAntMax
      }

      for (const g of porDot.values()) {
        const empReais = (g.emp / 100).toFixed(2)
        // valorAutorizado inicial se criar = maior vlSaldoAntDotacao visto (proxy da
        // dotação da LOA antes do 1º empenho); se ambíguo/ausente, o próprio empenhado.
        const autorizadoInicial = (Math.max(g.saldoAntMax, g.emp) / 100).toFixed(2)
        const existente = await tx.dotacaoDespesa.findUnique({
          where: { dotacao_unica: g.dotKey },
          select: { id: true },
        })
        let dotacaoId: string
        if (existente) {
          dotacaoId = existente.id
          await tx.dotacaoDespesa.update({ where: { id: dotacaoId }, data: { valorEmpenhado: empReais } })
        } else {
          const criada = await tx.dotacaoDespesa.create({
            data: { ...g.dotKey, valorAutorizado: autorizadoInicial, valorEmpenhado: empReais },
            select: { id: true },
          })
          dotacaoId = criada.id
          nDotCriadas++
        }

        // empenho de captura (numero estável CAP-{id8})
        const numero = `CAP-${dotacaoId.slice(0, 8)}`
        const emp = await tx.empenho.upsert({
          where: { entidadeId_numero: { entidadeId: entidade.id, numero } },
          create: {
            entidadeId: entidade.id,
            dotacaoDespesaId: dotacaoId,
            fornecedorId: fornecedor!.id,
            numero,
            tipo: 'ESTIMATIVO',
            data: dataMov,
            valor: empReais,
            valorLiquidado: (g.liq / 100).toFixed(2),
            historico: 'Empenho de CAPTURA da execução do PIT/TCE-PR (não é escrituração).',
          },
          update: { valor: empReais, valorLiquidado: (g.liq / 100).toFixed(2) },
          select: { id: true },
        })
        if (g.emp) movRows.push({ entidadeId: entidade.id, empenhoId: emp.id, tipo: 'EMPENHO', valor: empReais, data: dataMov, criadoPorId: usuario!.id, historico })
        if (g.liq) movRows.push({ entidadeId: entidade.id, empenhoId: emp.id, tipo: 'LIQUIDACAO', valor: (g.liq / 100).toFixed(2), data: dataMov, criadoPorId: usuario!.id, historico })
        if (g.pag) movRows.push({ entidadeId: entidade.id, empenhoId: emp.id, tipo: 'PAGAMENTO', valor: (g.pag / 100).toFixed(2), data: dataMov, criadoPorId: usuario!.id, historico })
      }
      await tx.movimentoEmpenho.createMany({ data: movRows })
      console.log(`  [apply] dotações: ${porDot.size} (criadas ${nDotCriadas}); movimentos: ${movRows.length}`)
    },
    { timeout: 300_000 },
  )
  return { entidade, ok: true }
}

async function main() {
  console.log(`\n═══ Execução da despesa ${ANO} — PIT/TCE-PR → Gênesis (Paranaguá/PR) ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ═══`)
  const xml = await obterXml()
  const porEntidade = classificarPorEntidade(xml)

  console.log(`\nEntidades no arquivo (todas):`)
  for (const [nome, b] of [...porEntidade].sort((a, b) => b[1].emp - a[1].emp))
    console.log(`  ${String(b.n).padStart(5)}  R$ ${reais(b.emp).padStart(18)}  ${nome}`)

  let todasOk = true
  for (const dp of DE_PARA_ENTIDADE) {
    const bucket = porEntidade.get(dp.pit)
    if (!bucket) {
      console.log(`\n!! Entidade PIT "${dp.pit}" ausente no arquivo — pulada.`)
      todasOk = false
      continue
    }
    const r = await processarEntidade(dp.pit, bucket.dots, bucket.n)
    todasOk = todasOk && r.ok
  }

  console.log(`\n${'─'.repeat(72)}`)
  if (APPLY) {
    console.log(`Concluído (--apply). Gravado nas 3 entidades de Paranaguá.`)
  } else {
    console.log(`DRY-RUN: nada gravado. Validação dos alvos: ${todasOk ? 'TODOS batem ao centavo.' : 'HÁ DIVERGÊNCIA (ver acima).'}`)
    console.log(`Reexecute com --apply para gravar.`)
  }

  await prisma.$disconnect()
  await pool.end()
}

main().catch(async (e) => {
  console.error('FALHOU:', e instanceof Error ? e.stack || e.message : e)
  await prisma.$disconnect()
  await pool.end()
  process.exit(1)
})
