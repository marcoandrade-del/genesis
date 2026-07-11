import { PrismaClient } from '@prisma/client'

/** Uma conferência do selo (o que bate / não bate). */
export type Conferencia = { nome: string; ok: boolean; detalhe: string }

/** O que foi convertido de UMA entidade + o que falta nela. */
export type SeloEntidade = {
  nome: string
  tipo: string
  receita: { previsto: number; arrecadado: number; nPrevisoes: number }
  despesa: { autorizado: number; empenhado: number; nDotacoes: number; comOrcadoEmpenho: number; soOrcado: number; soEmpenho: number; valorSemLoa: number }
  faltas: string[]
}

/** Uma ressalva do drill-down "o que não bate". */
export type Ressalva = { titulo: string; detalhe: string; valor?: number }

/** O selo completo de um município (a fonte de dados do Painel de Conversão). */
export type SeloConversao = {
  municipio: string
  uf: string
  ano: number
  entidades: SeloEntidade[]
  conferencias: Conferencia[]
  ressalvas: Ressalva[]
  faltas: string[]
  nota: { ok: number; total: number }
}

const num = (v: unknown): number => Math.round(Number(v ?? 0) * 100)

/**
 * Calcula o Selo de Conversão de um município a partir do que já está no banco:
 * o que foi convertido (receita/despesa por entidade), as conferências internas
 * (reconciliação orçado×empenhado, completude) e o que falta. Não depende do
 * conversor ter rodado nesta sessão — é uma leitura auditável do estado atual.
 */
export async function calcularSelo(prisma: PrismaClient, municipio: string, ano: number): Promise<SeloConversao> {
  const mun = await prisma.municipio.findFirstOrThrow({ where: { nome: municipio }, select: { estado: { select: { sigla: true } } } })
  const ents = await prisma.entidade.findMany({ where: { municipio: { is: { nome: municipio } } }, select: { id: true, nome: true, tipo: true }, orderBy: { tipo: 'asc' } })

  const entidades: SeloEntidade[] = []
  for (const e of ents) {
    const orc = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId: e.id, ano } }, select: { id: true } })
    const rec = orc ? await prisma.previsaoReceita.aggregate({ where: { orcamentoId: orc.id }, _sum: { valorPrevisto: true, valorArrecadado: true }, _count: true }) : null
    const desp = orc ? await prisma.dotacaoDespesa.aggregate({ where: { orcamentoId: orc.id }, _sum: { valorAutorizado: true, valorEmpenhado: true }, _count: true }) : null
    const comAmbos = orc ? await prisma.dotacaoDespesa.count({ where: { orcamentoId: orc.id, valorAutorizado: { gt: 0 }, valorEmpenhado: { gt: 0 } } }) : 0
    const soOrc = orc ? await prisma.dotacaoDespesa.count({ where: { orcamentoId: orc.id, valorAutorizado: { gt: 0 }, valorEmpenhado: 0 } }) : 0
    const semLoa = orc ? await prisma.dotacaoDespesa.aggregate({ where: { orcamentoId: orc.id, valorAutorizado: 0, valorEmpenhado: { gt: 0 } }, _sum: { valorEmpenhado: true }, _count: true }) : null
    const soEmp = semLoa?._count ?? 0

    const previsto = num(rec?._sum.valorPrevisto)
    const arrecadado = num(rec?._sum.valorArrecadado)
    const autorizado = num(desp?._sum.valorAutorizado)
    const empenhado = num(desp?._sum.valorEmpenhado)

    const faltas: string[] = []
    if (e.tipo !== 'CAMARA' && previsto === 0) faltas.push('receita não importada')
    if (autorizado === 0 && empenhado > 0) faltas.push('despesa orçada (QDD)')
    if (empenhado === 0 && autorizado > 0) faltas.push('execução (empenho)')
    entidades.push({
      nome: e.nome,
      tipo: e.tipo,
      receita: { previsto, arrecadado, nPrevisoes: rec?._count ?? 0 },
      despesa: { autorizado, empenhado, nDotacoes: desp?._count ?? 0, comOrcadoEmpenho: comAmbos, soOrcado: soOrc, soEmpenho: soEmp, valorSemLoa: num(semLoa?._sum.valorEmpenhado) },
      faltas,
    })
  }

  // conferências (o que bate / não bate)
  const totEmp = entidades.reduce((a, e) => a + e.despesa.empenhado, 0)
  const empCasado = entidades.reduce((a, e) => a + e.despesa.comOrcadoEmpenho, 0)
  const empSemLoa = entidades.reduce((a, e) => a + e.despesa.soEmpenho, 0)
  const comReceita = entidades.filter((e) => e.tipo !== 'CAMARA').every((e) => e.receita.previsto > 0)
  const comOrcado = entidades.every((e) => e.despesa.autorizado > 0 || e.tipo === 'CAMARA')
  const comExecucao = entidades.some((e) => e.despesa.empenhado > 0)

  const conferencias: Conferencia[] = [
    { nome: 'Receita importada', ok: comReceita, detalhe: comReceita ? 'todas as entidades com receita têm previsão' : `${entidades.filter((e) => e.tipo !== 'CAMARA' && e.receita.previsto === 0).length} entidade(s) sem receita` },
    { nome: 'Despesa orçada', ok: comOrcado, detalhe: comOrcado ? 'todas com dotação inicial' : `${entidades.filter((e) => e.despesa.autorizado === 0 && e.tipo !== 'CAMARA').length} sem QDD` },
    { nome: 'Execução (empenho)', ok: comExecucao, detalhe: `${entidades.filter((e) => e.despesa.empenhado > 0).length} entidade(s) com execução` },
    { nome: 'Reconciliação orçado×empenhado', ok: empCasado > 0, detalhe: `${empCasado} dotações com orçado+empenhado · ${empSemLoa} só empenho (execução fora da LOA)` },
  ]

  // ressalvas (drill-down "o que não bate")
  const ressalvas: Ressalva[] = []
  const totSemLoa = entidades.reduce((a, e) => a + e.despesa.valorSemLoa, 0)
  if (totSemLoa > 0) {
    const nEnt = entidades.filter((e) => e.despesa.soEmpenho > 0).length
    ressalvas.push({ titulo: 'Execução fora da LOA', detalhe: `empenho sem dotação inicial (fonte fora do de/para ou crédito adicional) em ${nEnt} entidade(s)`, valor: totSemLoa })
  }
  for (const e of entidades) {
    if (e.despesa.autorizado === 0 && e.despesa.empenhado > 0) ressalvas.push({ titulo: `${e.nome}`, detalhe: 'sem dotação orçada — só execução (o portal não trouxe o QDD desta entidade)', valor: e.despesa.empenhado })
    if (e.tipo !== 'CAMARA' && e.receita.previsto === 0 && e.despesa.empenhado > 0) ressalvas.push({ titulo: `${e.nome}`, detalhe: 'sem receita importada' })
  }

  const faltas = entidades.flatMap((e) => e.faltas.map((f) => `${e.nome}: ${f}`))
  const ok = conferencias.filter((c) => c.ok).length
  return { municipio, uf: mun.estado.sigla, ano, entidades, conferencias, ressalvas, faltas, nota: { ok, total: conferencias.length } }
}
