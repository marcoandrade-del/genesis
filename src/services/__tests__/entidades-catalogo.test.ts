import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { EntidadesCatalogoService } from '../entidades-catalogo.js'

describe('EntidadesCatalogoService', () => {
  let prisma: PrismaMock
  let svc: EntidadesCatalogoService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new EntidadesCatalogoService(prisma as never)
  })

  it('filtra por entidade ativa com plano contábil e ordena por município, tipo e nome', async () => {
    await svc.listar()
    const arg = prisma.entidade.findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ ativo: true, contasContabil: { some: {} } })
    expect(arg.orderBy).toEqual([{ municipio: { nome: 'asc' } }, { tipo: 'asc' }, { nome: 'asc' }])
    expect(arg.select.municipio).toEqual({ select: { id: true, nome: true, estado: { select: { sigla: true } } } })
    expect(arg.select.orcamentos).toEqual({ select: { ano: true } })
  })

  it('mapeia para o shape do contrato (todos os tipos) e deduplica/ordena os anos', async () => {
    prisma.entidade.findMany.mockResolvedValue([
      {
        id: 'ent-1',
        nome: 'Prefeitura do Município de Maringá',
        tipo: 'PREFEITURA',
        municipio: { id: 'mun-1', nome: 'Maringá', estado: { sigla: 'PR' } },
        orcamentos: [{ ano: 2026 }, { ano: 2025 }, { ano: 2026 }],
      },
      {
        id: 'ent-2',
        nome: 'Maringá Previdência',
        tipo: 'ADM_INDIRETA',
        municipio: { id: 'mun-1', nome: 'Maringá', estado: { sigla: 'PR' } },
        orcamentos: [{ ano: 2026 }],
      },
    ])
    const { entidades } = await svc.listar()
    expect(entidades).toEqual([
      {
        id: 'ent-1',
        nome: 'Prefeitura do Município de Maringá',
        tipo: 'PREFEITURA',
        municipio: { id: 'mun-1', nome: 'Maringá', uf: 'PR' },
        anosComOrcamento: [2025, 2026],
      },
      {
        id: 'ent-2',
        nome: 'Maringá Previdência',
        tipo: 'ADM_INDIRETA',
        municipio: { id: 'mun-1', nome: 'Maringá', uf: 'PR' },
        anosComOrcamento: [2026],
      },
    ])
  })

  it('entidade sem orçamento vira lista de anos vazia', async () => {
    prisma.entidade.findMany.mockResolvedValue([
      { id: 'e3', nome: 'Câmara de Beta', tipo: 'CAMARA', municipio: { id: 'm2', nome: 'Beta', estado: { sigla: 'PR' } }, orcamentos: [] },
    ])
    const { entidades } = await svc.listar()
    expect(entidades[0]!.anosComOrcamento).toEqual([])
  })
})
