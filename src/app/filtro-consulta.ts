/**
 * Parsing dos filtros das telas de consulta: intervalo de datas (dentro do
 * exercício) + contas selecionadas (multisseleção). Mantém as strings cruas
 * para repopular o formulário e expõe as datas já validadas para o service.
 */
export type FiltroConsultaQuery = { de?: string; ate?: string; contas?: string | string[] }

export type FiltroConsulta = {
  de?: Date
  ate?: Date
  contaIds: string[]
  /** strings normalizadas para o `value` dos inputs (vazias se inválidas). */
  deStr: string
  ateStr: string
}

/** Converte a query em filtro: datas só valem se forem ISO e do exercício `ano`. */
export function parseFiltroConsulta(q: FiltroConsultaQuery, ano: number): FiltroConsulta {
  const noExercicio = (s?: string): Date | undefined => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
    const d = new Date(`${s}T00:00:00Z`)
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() !== ano) return undefined
    return d
  }
  const de = noExercicio(q.de)
  const ate = noExercicio(q.ate)
  const contaIds = (Array.isArray(q.contas) ? q.contas : q.contas ? [q.contas] : []).filter(Boolean)
  const out: FiltroConsulta = { contaIds, deStr: de ? q.de! : '', ateStr: ate ? q.ate! : '' }
  if (de) out.de = de
  if (ate) out.ate = ate
  return out
}
