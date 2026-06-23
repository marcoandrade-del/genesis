import type { NaturezaInformacao } from '@prisma/client'

/**
 * Regras ESTRUTURAIS da PCASP para validar a configuração de um evento contábil
 * (par débito/crédito), impedindo que o usuário monte um lançamento que viole o
 * mecanismo de débitos e créditos / a segregação de subsistemas.
 *
 * Núcleo puro (sem I/O): recebe as contas já resolvidas no plano do modelo e
 * devolve as violações. Usado tanto no save do evento (admin) quanto como guarda
 * final no disparo.
 */

export type ContaParaRegra = {
  codigo: string
  admiteMovimento: boolean
  naturezaInformacao: NaturezaInformacao | null
}

export type ViolacaoPcasp = { regra: string; mensagem: string }

const SUBSISTEMA: Record<NaturezaInformacao, string> = {
  PATRIMONIAL: 'Patrimonial',
  ORCAMENTARIA: 'Orçamentária',
  CONTROLE: 'Controle',
}

/**
 * Valida um par débito/crédito contra as regras estruturais da PCASP.
 * `debito`/`credito` = null quando o código não existe no plano contábil do modelo.
 * Retorna a lista de violações (vazia = par válido).
 */
export function validarParPcasp(
  debitoCodigo: string,
  creditoCodigo: string,
  debito: ContaParaRegra | null,
  credito: ContaParaRegra | null,
): ViolacaoPcasp[] {
  const v: ViolacaoPcasp[] = []

  // 1. Existência no plano contábil do modelo.
  if (!debito) v.push({ regra: 'CONTA_INEXISTENTE', mensagem: `Conta de débito "${debitoCodigo}" não existe no plano contábil do modelo.` })
  if (!credito) v.push({ regra: 'CONTA_INEXISTENTE', mensagem: `Conta de crédito "${creditoCodigo}" não existe no plano contábil do modelo.` })

  // 2. Folha (analítica): só conta que admite movimento recebe lançamento.
  if (debito && !debito.admiteMovimento) v.push({ regra: 'CONTA_SINTETICA', mensagem: `Conta de débito "${debitoCodigo}" é sintética (não admite lançamento) — use uma conta analítica.` })
  if (credito && !credito.admiteMovimento) v.push({ regra: 'CONTA_SINTETICA', mensagem: `Conta de crédito "${creditoCodigo}" é sintética (não admite lançamento) — use uma conta analítica.` })

  // 3. Débito ≠ Crédito: não pode lançar a mesma conta nos dois lados.
  if (debitoCodigo === creditoCodigo) {
    v.push({ regra: 'DEBITO_IGUAL_CREDITO', mensagem: `Débito e crédito não podem ser a mesma conta (${debitoCodigo}).` })
  }

  // 4. Mesmo subsistema (natureza da informação): não misturar Patrimonial /
  //    Orçamentária / Controle num mesmo par (segregação dos subsistemas PCASP).
  if (debito?.naturezaInformacao && credito?.naturezaInformacao && debito.naturezaInformacao !== credito.naturezaInformacao) {
    v.push({
      regra: 'SUBSISTEMAS_DISTINTOS',
      mensagem: `Par mistura subsistemas da PCASP: débito é ${SUBSISTEMA[debito.naturezaInformacao]} e crédito é ${SUBSISTEMA[credito.naturezaInformacao]}. Um lançamento deve permanecer no mesmo subsistema (Patrimonial, Orçamentário ou Controle).`,
    })
  }

  return v
}

/**
 * Valida todos os pares D/C de um evento contra a PCASP. `contaPorCodigo` mapeia
 * código → conta (do plano do modelo); ausência = conta inexistente. Devolve as
 * violações achatadas, com o índice (1-based) do par para a mensagem.
 */
export function validarEventoPcasp(
  pares: Array<{ contaDebitoMascara: string; contaCreditoMascara: string }>,
  contaPorCodigo: Map<string, ContaParaRegra>,
): ViolacaoPcasp[] {
  const violacoes: ViolacaoPcasp[] = []
  pares.forEach((p, i) => {
    const d = p.contaDebitoMascara.trim()
    const c = p.contaCreditoMascara.trim()
    for (const viol of validarParPcasp(d, c, contaPorCodigo.get(d) ?? null, contaPorCodigo.get(c) ?? null)) {
      violacoes.push({ regra: viol.regra, mensagem: `Par ${i + 1}: ${viol.mensagem}` })
    }
  })
  return violacoes
}
