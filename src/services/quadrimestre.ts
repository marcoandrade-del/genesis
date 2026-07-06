/**
 * Quadrimestres do RGF (MDF 9ª ed., Parte IV): períodos fixos jan–abr,
 * mai–ago e set–dez, com publicação em até 30 dias após o encerramento
 * (LRF art. 55 §2º). Funções puras — datas em UTC para casar com os
 * campos `@db.Date` do banco (meia-noite UTC).
 */

export type NumeroQuadrimestre = 1 | 2 | 3

export interface Quadrimestre {
  q: NumeroQuadrimestre
  inicio: Date // 1º dia do quadrimestre (UTC)
  fim: Date // último dia do quadrimestre (UTC)
  rotulo: string // "1º Quadrimestre (janeiro a abril)"
  prazoPublicacao: Date // fim + 30 dias
  mesFim: number // 4 | 8 | 12
}

const ROTULOS: Record<NumeroQuadrimestre, string> = {
  1: '1º Quadrimestre (janeiro a abril)',
  2: '2º Quadrimestre (maio a agosto)',
  3: '3º Quadrimestre (setembro a dezembro)',
}

export function periodoQuadrimestre(ano: number, q: NumeroQuadrimestre): Quadrimestre {
  const mesFim = q * 4
  const inicio = new Date(Date.UTC(ano, (q - 1) * 4, 1))
  const fim = new Date(Date.UTC(ano, mesFim, 0)) // dia 0 do mês seguinte = último dia
  const prazoPublicacao = new Date(Date.UTC(ano, mesFim, 0))
  prazoPublicacao.setUTCDate(prazoPublicacao.getUTCDate() + 30)
  return { q, inicio, fim, rotulo: ROTULOS[q], prazoPublicacao, mesFim }
}

/** Quadrimestre "corrente" do exercício: o de hoje se o exercício é o atual;
 *  3º se o exercício já fechou; 1º se ainda não começou. */
export function quadrimestreCorrente(ano: number, hoje: Date): NumeroQuadrimestre {
  if (hoje.getFullYear() > ano) return 3
  if (hoje.getFullYear() < ano) return 1
  return (Math.floor(hoje.getMonth() / 4) + 1) as NumeroQuadrimestre
}

/** Lê `?q=` da rota; inválido/ausente cai no quadrimestre corrente. */
export function parseQuadrimestre(raw: unknown, ano: number, hoje: Date): NumeroQuadrimestre {
  if (raw === '1' || raw === 1) return 1
  if (raw === '2' || raw === 2) return 2
  if (raw === '3' || raw === 3) return 3
  return quadrimestreCorrente(ano, hoje)
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** "30/09/2026" — prazo de publicação formatado (UTC, pt-BR). */
export function formatarDataUtc(d: Date): string {
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}
