import { describe, it, expect, beforeEach, vi } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MunicipiosAtivosService } from '../municipios-ativos.js'

describe('MunicipiosAtivosService', () => {
  let prisma: PrismaMock
  let svc: MunicipiosAtivosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new MunicipiosAtivosService(prisma as never)
  })

  it('filtra por PREFEITURA ativa com plano contábil e ordena por nome', async () => {
    await svc.listar()
    const arg = prisma.municipio.findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ entidades: { some: { tipo: 'PREFEITURA', ativo: true, contasContabil: { some: {} } } } })
    expect(arg.orderBy).toEqual({ nome: 'asc' })
    // a entidade incluída repete o mesmo critério (só a PREFEITURA ativa entra como prefeitura)
    expect(arg.include.entidades.where).toEqual({ tipo: 'PREFEITURA', ativo: true, contasContabil: { some: {} } })
    expect(arg.include.estado).toEqual({ select: { sigla: true } })
  })

  it('mapeia para o shape do contrato e deduplica/ordena os anos com orçamento', async () => {
    prisma.municipio.findMany.mockResolvedValue([
      {
        id: 'mun-1',
        nome: 'Maringá',
        estado: { sigla: 'PR' },
        entidades: [
          {
            id: 'ent-1',
            nome: 'Prefeitura do Município de Maringá',
            cnpj: '76.282.656/0001-06',
            orcamentos: [{ ano: 2026 }, { ano: 2025 }, { ano: 2026 }],
          },
        ],
      },
    ])
    const { municipios } = await svc.listar()
    expect(municipios).toEqual([
      {
        id: 'mun-1',
        nome: 'Maringá',
        estado: 'PR',
        prefeitura: {
          id: 'ent-1',
          nome: 'Prefeitura do Município de Maringá',
          cnpj: '76.282.656/0001-06',
          anosComOrcamento: [2025, 2026],
        },
      },
    ])
  })

  it('cnpj nulo e sem orçamento viram null / lista vazia', async () => {
    prisma.municipio.findMany.mockResolvedValue([
      { id: 'mun-2', nome: 'Beta', estado: { sigla: 'PR' }, entidades: [{ id: 'e2', nome: 'Prefeitura Beta', cnpj: null, orcamentos: [] }] },
    ])
    const { municipios } = await svc.listar()
    expect(municipios[0]!.prefeitura.cnpj).toBeNull()
    expect(municipios[0]!.prefeitura.anosComOrcamento).toEqual([])
  })

  it('mais de uma PREFEITURA ativa: usa a primeira e emite aviso', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    prisma.municipio.findMany.mockResolvedValue([
      {
        id: 'mun-3',
        nome: 'Gama',
        estado: { sigla: 'SP' },
        entidades: [
          { id: 'primeira', nome: 'Prefeitura A', cnpj: null, orcamentos: [{ ano: 2026 }] },
          { id: 'segunda', nome: 'Prefeitura B', cnpj: null, orcamentos: [{ ano: 2026 }] },
        ],
      },
    ])
    const { municipios } = await svc.listar()
    expect(municipios[0]!.prefeitura.id).toBe('primeira')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
