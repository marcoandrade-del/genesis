import type { PrismaClient } from '@prisma/client'
import type { Verificacao } from './consistencia.js'
import { MatrizSaldosContabeisService } from './matriz-saldos-contabeis.js'
import type { LinhaMsc } from './matriz-saldos-contabeis.js'

/**
 * VALIDADOR ESTRUTURAL DA MSC — Dimensão I ("Gestão da Informação") do Ranking
 * da Qualidade da Informação Contábil e Fiscal (ICF/Siconfi, Portaria STN/MF
 * 807/2023). Reproduz sobre a MSC que o Gênesis emite as verificações de
 * ESTRUTURA que a STN aplica para pontuar o ente (catálogo `descricao_ranking.csv`
 * do ranking-municipios.tesouro.gov.br), no mesmo formato do Selo de Consistência
 * (`Verificacao[]` + selo) — consumível pelo Oxy pelo contrato memoriais-lrf.
 *
 * ATIVOS aqui: saldo invertido por natureza (por classe), presença das três
 * classes de contas, fonte de dígito 9 (recursos condicionados); atributo F
 * (financeiro) sem fonte (via `superavitFinanceiro`, #230) e detalhamento da
 * despesa — sem natureza/função/fonte — marcada por `contaCorrente.dotacaoId`
 * (#228). No encerramento, o zeramento de VPA/VPD. Ainda em STUB (`NAO_APLICAVEL`):
 * receita sem natureza/fonte (D1_00029/00030, exige distinguir a linha de receita
 * por prefixo PCASP), poder/órgão (D1_00019), CO e AI — dependem de dimensões
 * ainda não emitidas.
 */

const TOLERANCIA = 0.01 // centavo

export interface ValidacaoMsc {
  entidade: { id: string; nome: string; municipio: string; estado: string }
  ano: number
  mes: number
  verificacoes: Verificacao[]
  selo: { aprovadas: number; avaliadas: number; total: number }
}

export type OpcoesValidacao = { encerramento?: boolean }

/** Uma conta está invertida quando o sinal do saldo final contraria sua natureza. */
function invertida(l: LinhaMsc): boolean {
  if (l.naturezaSaldo === 'DEVEDORA') return l.saldoFinal < -TOLERANCIA // devedora com saldo credor
  if (l.naturezaSaldo === 'CREDORA') return l.saldoFinal > TOLERANCIA // credora com saldo devedor
  return false // MISTA ou sem natureza no modelo: não se avalia inversão
}

const na = (codigo: string, titulo: string, detalhe: string): Verificacao => ({
  codigo,
  titulo,
  status: 'NAO_APLICAVEL',
  esperado: null,
  obtido: null,
  delta: null,
  detalhe,
})

/**
 * "N contas de <contexto> com saldo invertido" para um recorte de classe. O teste
 * usa a `naturezaSaldo` da linha (não a classe): retificadoras (ex.: depreciação,
 * natureza credora dentro do Ativo) não são falsos positivos.
 */
function grupoInvertidas(
  codigo: string,
  titulo: string,
  ref: string,
  linhas: LinhaMsc[],
  pertence: (conta: string) => boolean,
): Verificacao {
  const alvo = linhas.filter((l) => pertence(l.conta) && l.naturezaSaldo != null && l.naturezaSaldo !== 'MISTA')
  const inv = alvo.filter(invertida)
  const amostra = inv.slice(0, 5).map((l) => l.conta).join(', ')
  return {
    codigo,
    titulo,
    status: inv.length === 0 ? 'OK' : 'DIVERGENTE',
    esperado: 0,
    obtido: inv.length,
    delta: inv.length,
    detalhe:
      `${ref}. ` +
      (inv.length === 0
        ? `Nenhuma das ${alvo.length} conta(s) avaliada(s) com saldo contrário à natureza.`
        : `${inv.length} de ${alvo.length} conta(s) com saldo contrário à natureza: ${amostra}${inv.length > 5 ? '…' : ''}.`),
  }
}

/** D1_00028 — a MSC deve trazer as três classes: patrimonial, orçamentária e controle. */
function classesCompletas(linhas: LinhaMsc[]): Verificacao {
  const d = new Set(linhas.map((l) => l.conta.charAt(0)))
  const grupos: Array<[string, string[]]> = [
    ['patrimonial', ['1', '2', '3', '4']],
    ['orçamentária', ['5', '6']],
    ['controle', ['7', '8']],
  ]
  const faltando = grupos.filter(([, cs]) => !cs.some((c) => d.has(c))).map(([nome]) => nome)
  const presentes = grupos.length - faltando.length
  return {
    codigo: 'MSC_DIM1_CLASSES_COMPLETAS',
    titulo: 'MSC com todas as classes (patrimonial, orçamentária e controle)',
    status: faltando.length === 0 ? 'OK' : 'DIVERGENTE',
    esperado: grupos.length,
    obtido: presentes,
    delta: presentes - grupos.length,
    detalhe:
      'D1_00028. ' +
      (faltando.length === 0
        ? 'As três classes de contas estão presentes na matriz.'
        : `Classe(s) ausente(s): ${faltando.join(', ')}.`),
  }
}

/** D1_00039/00040 — fontes de dígito 9 (recursos condicionados) não devem aparecer na execução. */
function fonteDigito9(linhas: LinhaMsc[]): Verificacao {
  const cond = linhas.filter((l) => (l.contaCorrente.fonte ?? '').startsWith('9'))
  const amostra = cond.slice(0, 5).map((l) => `${l.conta}·f${l.contaCorrente.fonte}`).join(', ')
  return {
    codigo: 'MSC_DIM1_FONTE_DIGITO9',
    titulo: 'Sem fontes de dígito 9 (recursos condicionados) nas contas da MSC',
    status: cond.length === 0 ? 'OK' : 'DIVERGENTE',
    esperado: 0,
    obtido: cond.length,
    delta: cond.length,
    detalhe:
      'D1_00039/D1_00040. ' +
      (cond.length === 0
        ? 'Nenhuma linha com fonte de recursos condicionados (dígito 9).'
        : `${cond.length} linha(s) com fonte dígito-9: ${amostra}${cond.length > 5 ? '…' : ''}.`),
  }
}

/** D1_00036 — no encerramento, VPA e VPD zeram (resultado apurado e transferido ao PL). */
function vpaVpdEncerramento(linhas: LinhaMsc[], encerramento: boolean): Verificacao {
  if (!encerramento) {
    return na(
      'MSC_DIM1_VPA_VPD_ENCERRAMENTO',
      'MSC de encerramento: VPA e VPD com saldo final zerado',
      'D1_00036 — requer a MSC de encerramento (apuração do resultado); a MSC agregada do mês mantém VPA/VPD com saldo por definição.',
    )
  }
  const vpavpd = linhas.filter((l) => l.conta.charAt(0) === '3' || l.conta.charAt(0) === '4')
  const comSaldo = vpavpd.filter((l) => Math.abs(l.saldoFinal) > TOLERANCIA)
  return {
    codigo: 'MSC_DIM1_VPA_VPD_ENCERRAMENTO',
    titulo: 'MSC de encerramento: VPA e VPD com saldo final zerado',
    status: comSaldo.length === 0 ? 'OK' : 'DIVERGENTE',
    esperado: 0,
    obtido: comSaldo.length,
    delta: comSaldo.length,
    detalhe:
      'D1_00036. ' +
      (comSaldo.length === 0
        ? `${vpavpd.length} conta(s) de VPA/VPD zeradas no encerramento.`
        : `${comSaldo.length} conta(s) de VPA/VPD ainda com saldo no encerramento — apuração do resultado incompleta.`),
  }
}

/** D1_00027 — contas com atributo F (financeiro) exigem detalhamento de fonte/destinação. */
function atributoFsemFonte(linhas: LinhaMsc[]): Verificacao {
  const fin = linhas.filter((l) => l.superavitFinanceiro === 'FINANCEIRO')
  const semFonte = fin.filter((l) => (l.contaCorrente.fonte ?? '') === '')
  const amostra = semFonte.slice(0, 5).map((l) => l.conta).join(', ')
  return {
    codigo: 'MSC_DIM1_ATRIBUTO_F_SEM_FONTE',
    titulo: 'Contas com atributo F (financeiro) com detalhamento de fonte',
    status: semFonte.length === 0 ? 'OK' : 'DIVERGENTE',
    esperado: 0,
    obtido: semFonte.length,
    delta: semFonte.length,
    detalhe:
      'D1_00027. ' +
      (semFonte.length === 0
        ? `Todas as ${fin.length} conta(s) financeira(s) têm fonte de recursos.`
        : `${semFonte.length} de ${fin.length} conta(s) financeira(s) sem fonte: ${amostra}${semFonte.length > 5 ? '…' : ''}.`),
  }
}

/**
 * Checks de detalhamento da despesa orçamentária. A linha de despesa é marcada
 * por `contaCorrente.dotacaoId` (a dotação viaja no razão desde a fase 2/#228);
 * entre essas, sinaliza as que não resolveram o campo exigido pelo Siconfi.
 */
function despesaSemCampo(codigo: string, titulo: string, ref: string, linhas: LinhaMsc[], falta: (cc: LinhaMsc['contaCorrente']) => boolean): Verificacao {
  const desp = linhas.filter((l) => l.contaCorrente.dotacaoId != null)
  const sem = desp.filter((l) => falta(l.contaCorrente))
  const amostra = sem.slice(0, 5).map((l) => l.conta).join(', ')
  return {
    codigo,
    titulo,
    status: sem.length === 0 ? 'OK' : 'DIVERGENTE',
    esperado: 0,
    obtido: sem.length,
    delta: sem.length,
    detalhe:
      `${ref}. ` +
      (sem.length === 0
        ? `${desp.length} linha(s) de despesa avaliada(s): detalhamento presente.`
        : `${sem.length} de ${desp.length} linha(s) de despesa sem o detalhamento: ${amostra}${sem.length > 5 ? '…' : ''}.`),
  }
}

/** Checks da Dim I ainda em STUB: receita (precisa distinguir a linha por prefixo PCASP) e dimensões não emitidas. */
const STUBS: Array<[string, string, string]> = [
  ['MSC_DIM1_RECEITA_SEM_FONTE', 'Receita orçamentária/deduções com fonte de recursos', 'D1_00029 — conta-corrente disponível (#228); ativação requer identificar a linha de receita orçamentária por prefixo PCASP. Follow-up.'],
  ['MSC_DIM1_RECEITA_SEM_NATUREZA', 'Receita orçamentária/deduções com natureza de receita', 'D1_00030 — conta-corrente disponível (#228); ativação requer identificar a linha de receita por prefixo PCASP. Follow-up.'],
  ['MSC_DIM1_PODER_ORGAO', 'Códigos de poder/órgão válidos', 'D1_00019 — requer a dimensão poder/órgão (fase 2b do emissor).'],
  ['MSC_DIM1_CO_SAUDE_EDUC_FUNDEB', 'Acompanhamento (CO) de saúde/educação/Fundeb detalhado', 'D1_00041/D1_00042/D1_00043 — requer a dimensão CO (não modelada).'],
  ['MSC_DIM1_AI_RESTOS_A_PAGAR', 'Informação complementar AI (ano de inscrição de restos a pagar)', 'D1_00044 — requer a dimensão AI (não modelada).'],
]

/**
 * Verificações estruturais da Dimensão I do ICF sobre as linhas da MSC. Função
 * pura (testável sem banco). Os códigos citam os ids D1_* do catálogo do ranking.
 */
export function validarEstruturaMsc(linhas: LinhaMsc[], opts: OpcoesValidacao = {}): Verificacao[] {
  const verificacoes: Verificacao[] = [
    grupoInvertidas('MSC_DIM1_ATIVO_INVERTIDO', 'Ativo (classe 1) sem saldo invertido pela natureza', 'D1_00021', linhas, (c) => c.charAt(0) === '1'),
    grupoInvertidas('MSC_DIM1_PASSIVO_INVERTIDO', 'Passivo (2.1/2.2) sem saldo invertido pela natureza', 'D1_00025', linhas, (c) => c.startsWith('2.1') || c.startsWith('2.2')),
    grupoInvertidas('MSC_DIM1_PL_INVERTIDO', 'Patrimônio Líquido (2.3) sem saldo invertido pela natureza', 'D1_00026', linhas, (c) => c.startsWith('2.3')),
    grupoInvertidas('MSC_DIM1_VPD_INVERTIDA', 'VPD (classe 3) sem saldo invertido pela natureza', 'D1_00034', linhas, (c) => c.charAt(0) === '3'),
    grupoInvertidas('MSC_DIM1_VPA_INVERTIDA', 'VPA (classe 4) sem saldo invertido pela natureza', 'D1_00035', linhas, (c) => c.charAt(0) === '4'),
    grupoInvertidas('MSC_DIM1_ORCAMENTARIA_INVERTIDA', 'Previsão/execução orçamentária (classes 5-6) sem saldo invertido', 'D1_00038', linhas, (c) => c.charAt(0) === '5' || c.charAt(0) === '6'),
    classesCompletas(linhas),
    fonteDigito9(linhas),
    atributoFsemFonte(linhas),
    despesaSemCampo('MSC_DIM1_DESPESA_SEM_NATUREZA', 'Despesa orçamentária com natureza de despesa', 'D1_00031', linhas, (cc) => cc.naturezaDespesa == null),
    despesaSemCampo('MSC_DIM1_DESPESA_SEM_FUNCAO', 'Despesa orçamentária com função/subfunção', 'D1_00032', linhas, (cc) => cc.funcao == null || cc.subfuncao == null),
    despesaSemCampo('MSC_DIM1_DESPESA_SEM_FONTE', 'Despesa orçamentária com fonte de recursos', 'D1_00033', linhas, (cc) => cc.fonte == null),
    vpaVpdEncerramento(linhas, opts.encerramento ?? false),
  ]
  for (const [codigo, titulo, detalhe] of STUBS) verificacoes.push(na(codigo, titulo, detalhe))
  return verificacoes
}

export class ValidadorMscService {
  private msc: MatrizSaldosContabeisService

  constructor(prisma: PrismaClient, msc?: MatrizSaldosContabeisService) {
    this.msc = msc ?? new MatrizSaldosContabeisService(prisma)
  }

  /** Valida a estrutura (Dim I do ICF) da MSC da entidade no mês. `null` se a entidade não existe. */
  async validar(entidadeId: string, ano: number, mes: number): Promise<ValidacaoMsc | null> {
    const matriz = await this.msc.emitir(entidadeId, ano, mes)
    if (!matriz) return null
    const verificacoes = validarEstruturaMsc(matriz.linhas)
    const avaliadas = verificacoes.filter((v) => v.status !== 'NAO_APLICAVEL').length
    const aprovadas = verificacoes.filter((v) => v.status === 'OK').length
    return {
      entidade: matriz.entidade,
      ano,
      mes,
      verificacoes,
      selo: { aprovadas, avaliadas, total: verificacoes.length },
    }
  }
}
