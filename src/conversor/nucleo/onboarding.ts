import { PrismaClient } from '@prisma/client'
import { EntidadeService } from '../../services/entidades.js'
import type { MunicipioConfig, EntidadeConfig } from './tipos.js'

/** Garante o Município (herda o modelo contábil do estado) e devolve o id. */
export async function garantirMunicipio(prisma: PrismaClient, cfg: MunicipioConfig): Promise<string> {
  const estado = await prisma.estado.findFirstOrThrow({ where: { sigla: cfg.uf }, select: { id: true } })
  const existente = await prisma.municipio.findFirst({ where: { nome: cfg.nome, estadoId: estado.id }, select: { id: true } })
  if (existente) return existente.id
  return (await prisma.municipio.create({ data: { nome: cfg.nome, estadoId: estado.id }, select: { id: true } })).id
}

/**
 * Garante a Entidade (onboarding via EntidadeService, que copia o plano de contas
 * do modelo + fontes) e o Orçamento do ano. Idempotente. Devolve os ids.
 */
export async function garantirEntidade(
  prisma: PrismaClient,
  cfg: MunicipioConfig,
  municipioId: string,
  ent: EntidadeConfig,
): Promise<{ entidadeId: string; orcamentoId: string }> {
  let entidade = await prisma.entidade.findFirst({ where: { nome: ent.nome, municipioId }, select: { id: true } })
  if (!entidade) entidade = await new EntidadeService(prisma).criar({ municipioId, nome: ent.nome, tipo: ent.tipo, ano: cfg.ano })

  const orc = await prisma.orcamento.findUnique({ where: { entidadeId_ano: { entidadeId: entidade.id, ano: cfg.ano } }, select: { id: true } })
  const orcamentoId = orc?.id ?? (await prisma.orcamento.create({ data: { entidadeId: entidade.id, ano: cfg.ano, status: 'RASCUNHO' }, select: { id: true } })).id
  return { entidadeId: entidade.id, orcamentoId }
}
