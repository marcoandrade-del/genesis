import { PrismaClient, Prisma } from '@prisma/client'
import type { Verificacao } from './consistencia.js'

/**
 * EMISSOR DA MATRIZ DE SALDOS CONTÁBEIS (MSC) — keystone do alvo ICF/Ranking
 * Siconfi. A MSC é uma projeção do razão único do Gênesis no leiaute da STN
 * (Portaria STN/MF 642/2019): por CONTA ANALÍTICA do PCASP estendido, quatro
 * tipos de valor no período — SI (saldo inicial), MD (movimento devedor), MC
 * (movimento credor) e SF (saldo final) — mais a natureza do saldo.
 *
 * Fase 2 (conta-corrente): cada linha é quebrada pelo SUB-RAZÃO que já viaja no
 * LancamentoItem — fonte de recursos, natureza da receita e a dotação da despesa
 * (com fonte/função resolvidas). Por isso os movimentos saem do razão bruto
 * (`LancamentoItem`, que carrega a cc), não de `ResumoMensalConta` (que colapsa
 * a cc). O balancete materializado (ResumoMensalConta) vira a REFERÊNCIA de
 * reconciliação do selo: as duas fontes — razão e agregado — têm de bater (Δ0).
 * Como todo o razão sai do MESMO lançamento que gera RREO/RGF, a MSC fecha por
 * construção (é a vantagem do ICF). Poder/órgão entra numa fase seguinte.
 */

export type NaturezaSaldoMsc = 'DEVEDORA' | 'CREDORA' | 'MISTA'

/**
 * Conta-corrente (sub-razão) de uma linha da MSC: as DIMENSÕES que viajam no
 * LancamentoItem além da conta PCASP. É o detalhamento que o Siconfi exige para
 * fonte/destinação, natureza da receita e a funcional-programática da despesa.
 * Tudo `null` = linha sem conta-corrente (ex.: abertura patrimonial agregada de
 * SaldoInicialAno; com detalhe em SaldoInicialCc a abertura sai por fonte).
 */
export interface ContaCorrenteMsc {
  fonte: string | null // fonte de recursos (item.fonteCodigo, ou a fonte da dotação na despesa)
  naturezaReceita: string | null // natureza da receita (cc da classe 6 / VPA)
  dotacaoId: string | null // dotação da despesa — carrega a funcional-programática completa
  funcao: string | null // função da despesa, resolvida da dotação
  subfuncao: string | null // subfunção da despesa, resolvida da dotação
  naturezaDespesa: string | null // natureza da despesa (conta de despesa da dotação)
}

export interface LinhaMsc {
  conta: string // código PCASP estendido (conta analítica)
  contaCorrente: ContaCorrenteMsc
  naturezaSaldo: NaturezaSaldoMsc | null
  superavitFinanceiro: string | null // atributo do PCASP (F/P/M/controles) — habilita os checks de atributo F
  // SI e SF vêm em "saldo devedor COM SINAL": positivo = devedor, negativo =
  // credor (o mesmo padrão do balancete em saldo-contabil).
  saldoInicial: number // SI — no início do mês
  movimentoDevedor: number // MD — Σ débitos do mês (≥ 0)
  movimentoCredor: number // MC — Σ créditos do mês (≥ 0)
  saldoFinal: number // SF — no fim do mês
}

export interface MatrizSaldosContabeis {
  entidade: { id: string; nome: string; municipio: string; estado: string }
  ano: number
  mes: number // período (1..12)
  tipo: 'AGREGADA' // encerramento (dezembro) vem em fase posterior
  metodologia: string
  linhas: LinhaMsc[]
  verificacoes: Verificacao[]
  selo: { aprovadas: number; avaliadas: number; total: number }
}

const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d))
const r2 = (x: number) => Math.round(x * 100) / 100
const TOLERANCIA = 0.01 // centavo

const METODOLOGIA =
  'MSC por conta-corrente (Portaria STN/MF 642/2019): contas analíticas do PCASP ' +
  'estendido quebradas por fonte/destinação, natureza da receita e dotação da despesa ' +
  '(fonte, função, subfunção e natureza da despesa), com o atributo do superávit financeiro ' +
  '(F) por linha; SI/MD/MC/SF do período em saldo devedor com sinal, agregados do razão ' +
  '(LancamentoItem) e reconciliados contra o balancete materializado (ResumoMensalConta). A ' +
  'abertura patrimonial entra por conta×fonte quando há detalhe (SaldoInicialCc, ex.: import ' +
  'da MSC oficial do Siconfi); sem detalhe, entra sem conta-corrente (SaldoInicialAno). ' +
  'Poder/órgão entra na próxima fase.'

/** Chave de agregação conta×conta-corrente ( = separador que não ocorre em código). */
const chaveCc = (
  contaId: string,
  fonte: string | null,
  natRec: string | null,
  dotId: string | null,
  funcao: string | null = null,
  subfuncao: string | null = null,
  natDesp: string | null = null,
) =>
  `${contaId}|${fonte ?? ''}|${natRec ?? ''}|${dotId ?? ''}|${funcao ?? ''}|${subfuncao ?? ''}|${natDesp ?? ''}`

/** Ordem estável da conta-corrente dentro de uma conta. */
const ordemCc = (cc: ContaCorrenteMsc) =>
  `${cc.fonte ?? ''}|${cc.naturezaReceita ?? ''}|${cc.funcao ?? ''}|${cc.dotacaoId ?? ''}`

export class MatrizSaldosContabeisService {
  constructor(private prisma: PrismaClient) {}

  /** MSC por conta-corrente da entidade no mês (período 1..12). `null` se a entidade não existe. */
  async emitir(entidadeId: string, ano: number, mes: number): Promise<MatrizSaldosContabeis | null> {
    const ent = await this.prisma.entidade.findUnique({
      where: { id: entidadeId },
      select: { id: true, nome: true, municipio: { select: { nome: true, estado: { select: { sigla: true } } } } },
    })
    if (!ent) return null

    // Contas ANALÍTICAS (admiteMovimento) da entidade/exercício — a MSC só usa
    // as contas de último nível do PCASP estendido.
    const contas = await this.prisma.contaContabilEntidade.findMany({
      where: { entidadeId, ano, admiteMovimento: true },
      select: { id: true, codigo: true, modeloContaId: true },
    })

    // Natureza do saldo e atributo do PCASP (F/P/M) vêm do modelo padrão
    // (ContaContabilEntidade não os guarda).
    const modeloIds = [...new Set(contas.map((c) => c.modeloContaId).filter((x): x is string => !!x))]
    const modelos = modeloIds.length
      ? await this.prisma.conta.findMany({ where: { id: { in: modeloIds } }, select: { id: true, naturezaSaldo: true, superavitFinanceiro: true } })
      : []
    const natPorModelo = new Map(modelos.map((m) => [m.id, (m.naturezaSaldo as NaturezaSaldoMsc | null) ?? null]))
    const superavitPorModelo = new Map(modelos.map((m) => [m.id, (m.superavitFinanceiro as string | null) ?? null]))
    const codigoPorConta = new Map(contas.map((c) => [c.id, c.codigo]))
    const natPorConta = new Map(
      contas.map((c) => [c.id, c.modeloContaId ? natPorModelo.get(c.modeloContaId) ?? null : null]),
    )
    const superavitPorConta = new Map(
      contas.map((c) => [c.id, c.modeloContaId ? superavitPorModelo.get(c.modeloContaId) ?? null : null]),
    )

    // De/para de FONTE local→STN: a MSC do Siconfi é em fonte STN, mas o razão
    // guarda a fonte LOCAL do QDD/Elotech (o modelo do estado, ex.: PR, não é a
    // STN). Converte-se na SAÍDA (aqui), mantendo o razão no modelo local. Sem
    // de/para cadastrado a fonte passa direto (fontes já-STN de imports, ou entes
    // sem o de/para carregado). Ver [B] em coordenacao-sessoes / resolver_fonte_stn.
    const fontesEnt = await this.prisma.fonteRecursoEntidade.findMany({
      where: { entidadeId, ano, fonteStnCodigo: { not: null } },
      select: { codigo: true, fonteStnCodigo: true },
    })
    const mapaStn = new Map(fontesEnt.map((f) => [f.codigo, f.fonteStnCodigo!]))
    const stn = (f: string | null): string | null => (f == null ? null : mapaStn.get(f) ?? f)

    const iniciais = await this.prisma.saldoInicialAno.findMany({
      where: { entidadeId, ano },
      select: { contaId: true, valor: true },
    })
    const inicialPorConta = new Map(iniciais.map((s) => [s.contaId, n(s.valor)]))

    // Detalhe da abertura por conta-corrente (fonte) — quando existe para a
    // conta, tem PRECEDÊNCIA sobre o agregado (que é a Σ do detalhe, por
    // contrato do import): a abertura sai em linhas conta×fonte.
    const iniciaisCc = await this.prisma.saldoInicialCc.findMany({
      where: { entidadeId, ano },
      select: { contaId: true, fonteCodigo: true, valor: true },
    })
    const inicialCcPorConta = new Map<string, { fonte: string | null; valor: number }[]>()
    for (const s of iniciaisCc) {
      const lista = inicialCcPorConta.get(s.contaId) ?? []
      lista.push({ fonte: s.fonteCodigo || null, valor: n(s.valor) })
      inicialCcPorConta.set(s.contaId, lista)
    }

    // Movimentos saem do RAZÃO por conta-corrente. Recortes por data (o mês vem
    // de lancamento.data — o mesmo UTCMonth que alimenta o ResumoMensalConta):
    // "antes" (meses anteriores do ano → compõe o SI) e "domês" (MD/MC do mês).
    const inicioAno = new Date(Date.UTC(ano, 0, 1))
    const inicioMes = new Date(Date.UTC(ano, mes - 1, 1))
    const inicioProx = new Date(Date.UTC(ano, mes, 1))
    const antes = await this.prisma.lancamentoItem.groupBy({
      by: ['contaId', 'tipo', 'fonteCodigo', 'naturezaReceitaCodigo', 'dotacaoDespesaId', 'funcaoCodigo', 'subfuncaoCodigo', 'naturezaDespesaCodigo'],
      where: { lancamento: { entidadeId, data: { gte: inicioAno, lt: inicioMes } } },
      _sum: { valor: true },
    })
    const domes = await this.prisma.lancamentoItem.groupBy({
      by: ['contaId', 'tipo', 'fonteCodigo', 'naturezaReceitaCodigo', 'dotacaoDespesaId', 'funcaoCodigo', 'subfuncaoCodigo', 'naturezaDespesaCodigo'],
      where: { lancamento: { entidadeId, data: { gte: inicioMes, lt: inicioProx } } },
      _sum: { valor: true },
    })

    // Dotações referenciadas → fonte + função + subfunção + natureza da despesa
    // (dimensões da cc da despesa).
    const dotIds = [...new Set([...antes, ...domes].map((g) => g.dotacaoDespesaId).filter((x): x is string => !!x))]
    const dots = dotIds.length
      ? await this.prisma.dotacaoDespesa.findMany({
          where: { id: { in: dotIds } },
          select: {
            id: true,
            fonteRecurso: { select: { codigo: true } },
            funcao: { select: { codigo: true } },
            subfuncao: { select: { codigo: true } },
            contaDespesa: { select: { codigo: true } },
          },
        })
      : []
    const dotInfo = new Map(
      dots.map((d) => [
        d.id,
        {
          fonte: stn(d.fonteRecurso?.codigo ?? null),
          funcao: d.funcao?.codigo ?? null,
          subfuncao: d.subfuncao?.codigo ?? null,
          naturezaDespesa: d.contaDespesa?.codigo ?? null,
        },
      ]),
    )

    // cc CRUA da despesa (Restos a Pagar, sem dotação) viaja no próprio bucket.
    type Bucket = { contaId: string; fonte: string | null; natRec: string | null; dotId: string | null; funcao: string | null; subfuncao: string | null; natDesp: string | null; si: number; md: number; mc: number }
    const buckets = new Map<string, Bucket>()
    const bucket = (contaId: string, fonte: string | null, natRec: string | null, dotId: string | null, funcao: string | null = null, subfuncao: string | null = null, natDesp: string | null = null): Bucket => {
      const k = chaveCc(contaId, fonte, natRec, dotId, funcao, subfuncao, natDesp)
      let b = buckets.get(k)
      if (!b) {
        b = { contaId, fonte, natRec, dotId, funcao, subfuncao, natDesp, si: 0, md: 0, mc: 0 }
        buckets.set(k, b)
      }
      return b
    }

    // Movimento anterior ao mês → SI em débito com sinal (débito soma, crédito subtrai).
    for (const g of antes) {
      const b = bucket(g.contaId, stn(g.fonteCodigo), g.naturezaReceitaCodigo, g.dotacaoDespesaId, g.funcaoCodigo, g.subfuncaoCodigo, g.naturezaDespesaCodigo)
      const v = n(g._sum.valor)
      if (g.tipo === 'DEBITO') b.si += v
      else b.si -= v
    }
    // Movimento do mês → MD/MC.
    for (const g of domes) {
      const b = bucket(g.contaId, stn(g.fonteCodigo), g.naturezaReceitaCodigo, g.dotacaoDespesaId, g.funcaoCodigo, g.subfuncaoCodigo, g.naturezaDespesaCodigo)
      const v = n(g._sum.valor)
      if (g.tipo === 'DEBITO') b.md += v
      else b.mc += v
    }
    // Abertura: contas COM detalhe por conta-corrente (SaldoInicialCc) entram em
    // buckets por fonte; as demais caem no bucket sem cc (SaldoInicialAno). Ambas
    // em débito com sinal (conta credora entra negativa).
    for (const c of contas) {
      const detalhe = inicialCcPorConta.get(c.id)
      if (detalhe?.length) {
        for (const d of detalhe) {
          if (d.valor === 0) continue
          const devedor = natPorConta.get(c.id) === 'CREDORA' ? -d.valor : d.valor
          bucket(c.id, stn(d.fonte), null, null).si += devedor
        }
        continue // o detalhe substitui o agregado da conta (Σ detalhe = agregado)
      }
      const abertura = inicialPorConta.get(c.id) ?? 0
      if (abertura === 0) continue
      const aberturaDevedor = natPorConta.get(c.id) === 'CREDORA' ? -abertura : abertura
      bucket(c.id, null, null, null).si += aberturaDevedor
    }

    const linhas: LinhaMsc[] = []
    for (const b of buckets.values()) {
      const codigo = codigoPorConta.get(b.contaId)
      if (!codigo) continue // movimento numa conta fora da lista analítica (defensivo)
      const si = r2(b.si)
      const md = r2(b.md)
      const mc = r2(b.mc)
      const sf = r2(si + md - mc)
      // Conta-corrente sem saldo e sem movimento no período não gera linha.
      if (si === 0 && md === 0 && mc === 0 && sf === 0) continue
      const dinfo = b.dotId ? dotInfo.get(b.dotId) : null
      // cc da despesa: da dotação quando há; senão da cc crua (Restos a Pagar).
      const contaCorrente: ContaCorrenteMsc = {
        fonte: b.fonte ?? dinfo?.fonte ?? null,
        naturezaReceita: b.natRec,
        dotacaoId: b.dotId,
        funcao: dinfo?.funcao ?? b.funcao ?? null,
        subfuncao: dinfo?.subfuncao ?? b.subfuncao ?? null,
        naturezaDespesa: dinfo?.naturezaDespesa ?? b.natDesp ?? null,
      }
      linhas.push({
        conta: codigo,
        contaCorrente,
        naturezaSaldo: natPorConta.get(b.contaId) ?? null,
        superavitFinanceiro: superavitPorConta.get(b.contaId) ?? null,
        saldoInicial: si,
        movimentoDevedor: md,
        movimentoCredor: mc,
        saldoFinal: sf,
      })
    }
    linhas.sort((a, b) => a.conta.localeCompare(b.conta) || ordemCc(a.contaCorrente).localeCompare(ordemCc(b.contaCorrente)))

    // Referência de reconciliação: o balancete materializado do mês (por conta,
    // sem cc). Σ das cc de cada lado tem de bater com ele — prova que a quebra
    // por conta-corrente não inventou nem perdeu movimento.
    const resumos = await this.prisma.resumoMensalConta.findMany({
      where: { entidadeId, ano, mes },
      select: { totalDebito: true, totalCredito: true },
    })
    const refMd = r2(resumos.reduce((a, s) => a + n(s.totalDebito), 0))
    const refMc = r2(resumos.reduce((a, s) => a + n(s.totalCredito), 0))

    const verificacoes = this.verificar(linhas, refMd, refMc)
    const avaliadas = verificacoes.filter((v) => v.status !== 'NAO_APLICAVEL').length
    const aprovadas = verificacoes.filter((v) => v.status === 'OK').length

    return {
      entidade: { id: ent.id, nome: ent.nome, municipio: ent.municipio?.nome ?? '', estado: ent.municipio?.estado?.sigla ?? '' },
      ano,
      mes,
      tipo: 'AGREGADA',
      metodologia: METODOLOGIA,
      linhas,
      verificacoes,
      selo: { aprovadas, avaliadas, total: verificacoes.length },
    }
  }

  /**
   * Selo da MSC: identidades da partida dobrada + reconciliação com o balancete,
   * verificadas por máquina — o mesmo padrão do Selo de Consistência.
   *  - Partida dobrada: no período, Σ MD = Σ MC.
   *  - Balanço fecha: no fim do período, Σ SF (com sinal) = 0.
   *  - Reconcilia MD/MC: Σ das conta-correntes = o balancete materializado
   *    (ResumoMensalConta) do mês — a quebra por cc não alterou o total por lado.
   */
  private verificar(linhas: LinhaMsc[], refMd: number, refMc: number): Verificacao[] {
    const compara = (codigo: string, titulo: string, esperado: number, obtido: number, detalhe: string): Verificacao => {
      const delta = r2(obtido - esperado)
      return { codigo, titulo, status: Math.abs(delta) <= TOLERANCIA ? 'OK' : 'DIVERGENTE', esperado: r2(esperado), obtido: r2(obtido), delta, detalhe }
    }
    const totalMd = r2(linhas.reduce((a, l) => a + l.movimentoDevedor, 0))
    const totalMc = r2(linhas.reduce((a, l) => a + l.movimentoCredor, 0))
    const totalSf = r2(linhas.reduce((a, l) => a + l.saldoFinal, 0))
    return [
      compara('MSC_PARTIDA_DOBRADA', 'Partida dobrada: Σ movimento devedor × Σ movimento credor', totalMc, totalMd, 'Todo débito do período tem crédito de igual valor; a soma dos dois lados fecha.'),
      compara('MSC_BALANCO_FECHA', 'Balanço fecha: Σ saldo final (com sinal) = 0', 0, totalSf, 'No fim do período o balancete zera em saldo devedor com sinal — o razão está equilibrado.'),
      compara('MSC_RECONCILIA_MD', 'Reconciliação: Σ movimento devedor das conta-correntes × balancete', refMd, totalMd, 'A soma dos débitos quebrados por conta-corrente é igual ao movimento devedor do balancete materializado (ResumoMensalConta) — nada foi inventado nem perdido na quebra.'),
      compara('MSC_RECONCILIA_MC', 'Reconciliação: Σ movimento credor das conta-correntes × balancete', refMc, totalMc, 'A soma dos créditos quebrados por conta-corrente é igual ao movimento credor do balancete materializado (ResumoMensalConta).'),
    ]
  }
}
