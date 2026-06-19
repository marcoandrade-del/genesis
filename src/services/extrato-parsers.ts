import { ErroNegocio } from '../errors.js'

/** Uma linha normalizada do extrato bancário, pronta para virar MovimentoBancario. */
export type LinhaExtrato = {
  data: string // YYYY-MM-DD
  valor: string // módulo, 2 casas (ex.: "1234.56")
  sentido: 'CREDITO' | 'DEBITO'
  historico?: string
  documento?: string
}

/** Normaliza data 'YYYY-MM-DD', 'DD/MM/YYYY' ou 'YYYYMMDD' → 'YYYY-MM-DD'. */
export function normalizarData(raw: string): string | null {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s) // OFX DTPOSTED (pode ter hora depois)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

/**
 * Normaliza valor monetário em vários formatos (BR "1.234,56", US "1234.56",
 * com sinal). Retorna { valor: módulo "1234.56", negativo: boolean } ou null.
 */
export function normalizarValor(raw: string): { valor: string; negativo: boolean } | null {
  let s = raw.trim().replace(/\s/g, '')
  if (!s) return null
  const negativo = s.startsWith('-') || /^\(.*\)$/.test(s)
  s = s.replace(/[()]/g, '').replace(/^[+-]/, '')
  if (s.includes('.') && s.includes(',')) {
    // o último separador é o decimal; o outro é milhar
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return { valor: n.toFixed(2), negativo }
}

/**
 * CSV simples do extrato: uma linha por movimento, colunas
 * `data;valor;historico;documento` (delimitador `;` ou `,`; cabeçalho opcional).
 * Valor positivo = CRÉDITO, negativo = DÉBITO.
 */
export function parseCSV(conteudo: string): LinhaExtrato[] {
  const linhas = conteudo.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (linhas.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Arquivo CSV vazio.')
  const delim = (linhas[0].match(/;/g)?.length ?? 0) >= (linhas[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const out: LinhaExtrato[] = []
  for (const linha of linhas) {
    const col = linha.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''))
    const data = normalizarData(col[0] ?? '')
    const valor = normalizarValor(col[1] ?? '')
    if (!data || !valor) continue // pula cabeçalho e linhas inválidas
    out.push({
      data,
      valor: valor.valor,
      sentido: valor.negativo ? 'DEBITO' : 'CREDITO',
      historico: col[2] || undefined,
      documento: col[3] || undefined,
    })
  }
  if (out.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nenhum movimento válido no CSV (esperado: data;valor;histórico).')
  return out
}

/** Extrai o conteúdo da 1ª tag `<TAG>valor` de um bloco OFX (SGML sem fechamento). */
function tagOfx(bloco: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([^<\r\n]*)`, 'i').exec(bloco)
  return m ? m[1].trim() : undefined
}

/**
 * OFX (extrato de Internet Banking): extrai os blocos `<STMTTRN>` e lê
 * TRNTYPE / DTPOSTED / TRNAMT / MEMO|NAME / FITID. Tolerante ao SGML sem
 * fechamento (formato OFX 1.x).
 */
export function parseOFX(conteudo: string): LinhaExtrato[] {
  const blocos = conteudo.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) ?? []
  const out: LinhaExtrato[] = []
  for (const b of blocos) {
    const data = normalizarData(tagOfx(b, 'DTPOSTED') ?? '')
    const valorRaw = tagOfx(b, 'TRNAMT')
    if (!data || !valorRaw) continue
    const valor = normalizarValor(valorRaw)
    if (!valor) continue
    const trntype = (tagOfx(b, 'TRNTYPE') ?? '').toUpperCase()
    const sentido = trntype === 'DEBIT' || (trntype !== 'CREDIT' && valor.negativo) ? 'DEBITO' : 'CREDITO'
    out.push({
      data,
      valor: valor.valor,
      sentido,
      historico: tagOfx(b, 'MEMO') ?? tagOfx(b, 'NAME'),
      documento: tagOfx(b, 'FITID'),
    })
  }
  if (out.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nenhuma transação <STMTTRN> encontrada no OFX.')
  return out
}

/** Campo posicional (1-based, inclusivo) de uma linha de tamanho fixo. */
function campo(linha: string, inicio: number, fim: number): string {
  return linha.slice(inicio - 1, fim).trim()
}

/** Valor CNAB (centavos, sem ponto) → "1234.56". */
function valorCnab(raw: string): string {
  const n = Number(raw.replace(/\D/g, '')) / 100
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

/**
 * CNAB 240 — arquivo de RETORNO de cobrança (Febraban). Lê os títulos LIQUIDADOS:
 * para cada par de detalhe Segmento T (dados do título) + Segmento U (valores pagos),
 * emite um crédito com o valor pago e a data de crédito. Só registros com valor pago > 0.
 * (CNAB 400 e arrecadação de convênio não são cobertos aqui.)
 */
export function parseCNAB240(conteudo: string): LinhaExtrato[] {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.length >= 240)
  if (linhas.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Arquivo CNAB 240 inválido (linhas de 240 posições não encontradas).')
  const out: LinhaExtrato[] = []
  let docPendente: string | undefined
  for (const l of linhas) {
    if (campo(l, 8, 8) !== '3') continue // só registros de detalhe
    const seg = campo(l, 14, 14).toUpperCase()
    if (seg === 'T') {
      // nº do documento (seu número) — guarda para casar com o Segmento U seguinte
      docPendente = campo(l, 59, 73) || campo(l, 41, 58) || undefined
    } else if (seg === 'U') {
      const valor = valorCnab(campo(l, 78, 92)) // valor pago pelo sacado
      const dataRaw = campo(l, 146, 153) || campo(l, 138, 145) // data crédito / ocorrência (DDMMAAAA)
      const data = normalizarData(`${dataRaw.slice(4, 8)}${dataRaw.slice(2, 4)}${dataRaw.slice(0, 2)}`)
      if (data && Number(valor) > 0) {
        out.push({ data, valor, sentido: 'CREDITO', historico: 'Liquidação CNAB', documento: docPendente })
      }
      docPendente = undefined
    }
  }
  if (out.length === 0) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nenhum título liquidado encontrado no CNAB 240 (Segmento U com valor pago).')
  return out
}

/** Despacha o parser pelo formato. */
export function parseExtrato(formato: 'CSV' | 'OFX' | 'CNAB', conteudo: string): LinhaExtrato[] {
  if (formato === 'CSV') return parseCSV(conteudo)
  if (formato === 'OFX') return parseOFX(conteudo)
  return parseCNAB240(conteudo)
}
