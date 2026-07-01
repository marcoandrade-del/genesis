import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { SolicitacoesMemorialService } from '../solicitacoes-memorial.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: SolicitacoesMemorialService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new SolicitacoesMemorialService(prisma as never)
})

const RCL_OK = { nome: 'RCL PR', deducoes: [{ rotulo: 'FUNDEB', prefixos: ['1.7'] }] }
const FONTE_OK = { nome: 'Fonte PR', regras: [{ finalidade: 'MDE', prefixos: ['103'] }] }
const PESSOAL_OK = { nome: 'Pessoal PR', inclusoes: [{ rotulo: 'Ativos', prefixos: ['3.1'] }], exclusoes: [] }

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return {
    usuarioId: 'u1',
    estadoId: 'est1',
    entidadePreviewId: 'ent1',
    ano: 2026,
    rcl: RCL_OK,
    fonte: FONTE_OK,
    pessoal: PESSOAL_OK,
    ...over,
  } as never
}

describe('SolicitacoesMemorialService.criar', () => {
  it('rejeita usuarioId ausente', async () => {
    await expect(service.criar(dadosOk({ usuarioId: undefined }))).rejects.toThrow('usuarioId')
  })

  it('rejeita estadoId ausente', async () => {
    await expect(service.criar(dadosOk({ estadoId: undefined }))).rejects.toThrow('estadoId')
  })

  it('rejeita RCL inválida', async () => {
    await expect(service.criar(dadosOk({ rcl: { deducoes: [] } }))).rejects.toThrow('RCL inválida')
  })

  it('rejeita classificação de fonte inválida', async () => {
    await expect(service.criar(dadosOk({ fonte: { regras: [] } }))).rejects.toThrow('fonte inválida')
  })

  it('rejeita composição de pessoal inválida', async () => {
    await expect(service.criar(dadosOk({ pessoal: { inclusoes: [] } }))).rejects.toThrow('pessoal inválida')
  })

  it('rejeita quando nenhum memorial é informado', async () => {
    await expect(
      service.criar(dadosOk({ rcl: null, fonte: null, pessoal: null })),
    ).rejects.toThrow('Nenhum memorial')
  })

  it('rejeita estado inexistente', async () => {
    prisma.estado.findUnique.mockResolvedValue(null)
    await expect(service.criar(dadosOk())).rejects.toThrow('Estado não encontrado')
  })

  it('rejeita quando já há proposta pendente para o estado', async () => {
    prisma.estado.findUnique.mockResolvedValue({ id: 'est1' })
    prisma.solicitacaoMemorial.findFirst.mockResolvedValue({ id: 's1' })
    await expect(service.criar(dadosOk())).rejects.toThrow('pendente')
  })

  it('cria gravando os 3 memoriais normalizados + referência do teste (justificativa trimada)', async () => {
    prisma.estado.findUnique.mockResolvedValue({ id: 'est1' })
    prisma.solicitacaoMemorial.findFirst.mockResolvedValue(null)
    prisma.solicitacaoMemorial.create.mockResolvedValue({ id: 's1' })
    await service.criar(dadosOk({ justificativa: '  Esfinge SC  ' }))
    const data = prisma.solicitacaoMemorial.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      usuarioId: 'u1',
      estadoId: 'est1',
      entidadePreviewId: 'ent1',
      ano: 2026,
      justificativa: 'Esfinge SC',
    })
    expect(data.rclComposicao).toEqual(RCL_OK)
    expect(data.fonteClassificacao).toEqual(FONTE_OK)
    expect(data.pessoalComposicao).toEqual(PESSOAL_OK)
  })

  it('memorial ausente vira DbNull no create', async () => {
    prisma.estado.findUnique.mockResolvedValue({ id: 'est1' })
    prisma.solicitacaoMemorial.findFirst.mockResolvedValue(null)
    prisma.solicitacaoMemorial.create.mockResolvedValue({ id: 's1' })
    await service.criar(dadosOk({ fonte: null, pessoal: null }))
    const data = prisma.solicitacaoMemorial.create.mock.calls[0][0].data
    expect(data.rclComposicao).toEqual(RCL_OK)
    expect(data.fonteClassificacao).toBe(Prisma.DbNull)
    expect(data.pessoalComposicao).toBe(Prisma.DbNull)
  })
})

describe('SolicitacoesMemorialService.listarMinhas / listarPendentes', () => {
  it('lista as do usuário, mais recentes primeiro', async () => {
    prisma.solicitacaoMemorial.findMany.mockResolvedValue([])
    await service.listarMinhas('u1')
    expect(prisma.solicitacaoMemorial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usuarioId: 'u1' }, orderBy: { criadoEm: 'desc' } }),
    )
  })

  it('lista só PENDENTE, mais antigas primeiro', async () => {
    prisma.solicitacaoMemorial.findMany.mockResolvedValue([])
    await service.listarPendentes()
    expect(prisma.solicitacaoMemorial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDENTE' }, orderBy: { criadoEm: 'asc' } }),
    )
  })
})

describe('SolicitacoesMemorialService.cancelar', () => {
  it('rejeita inexistente', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue(null)
    await expect(service.cancelar('s1', 'u1')).rejects.toThrow('não encontrada')
  })

  it('rejeita de outro usuário', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue({ id: 's1', usuarioId: 'u2', status: 'PENDENTE' })
    await expect(service.cancelar('s1', 'u1')).rejects.toThrow('não encontrada')
  })

  it('rejeita quando não está pendente', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue({ id: 's1', usuarioId: 'u1', status: 'APROVADA' })
    await expect(service.cancelar('s1', 'u1')).rejects.toThrow('pendente')
  })

  it('cancela a própria pendente', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue({ id: 's1', usuarioId: 'u1', status: 'PENDENTE' })
    prisma.solicitacaoMemorial.update.mockResolvedValue({ id: 's1', status: 'CANCELADA' })
    await service.cancelar('s1', 'u1')
    expect(prisma.solicitacaoMemorial.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'CANCELADA' },
    })
  })
})

describe('SolicitacoesMemorialService.aprovar', () => {
  it('rejeita inexistente', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue(null)
    await expect(service.aprovar('s1', 'adm')).rejects.toThrow('não encontrada')
  })

  it('rejeita já decidida', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue({ id: 's1', status: 'REJEITADA' })
    await expect(service.aprovar('s1', 'adm')).rejects.toThrow('já foi decidida')
  })

  it('grava o snapshot no Estado e marca APROVADA (com observação)', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue({
      id: 's1',
      estadoId: 'est1',
      status: 'PENDENTE',
      rclComposicao: RCL_OK,
      fonteClassificacao: FONTE_OK,
      pessoalComposicao: null,
    })
    prisma.estado.update.mockResolvedValue({ id: 'est1' })
    prisma.solicitacaoMemorial.update.mockResolvedValue({ id: 's1', status: 'APROVADA' })
    await service.aprovar('s1', 'adm', '  ok  ')
    expect(prisma.estado.update).toHaveBeenCalledWith({
      where: { id: 'est1' },
      data: {
        rclComposicao: RCL_OK,
        fonteClassificacao: FONTE_OK,
        pessoalComposicao: Prisma.DbNull,
      },
    })
    const data = prisma.solicitacaoMemorial.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'APROVADA', decididoPorId: 'adm', observacaoDecisao: 'ok' })
    expect(data.decididoEm).toBeInstanceOf(Date)
  })
})

describe('SolicitacoesMemorialService.rejeitar', () => {
  it('rejeita inexistente', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue(null)
    await expect(service.rejeitar('s1', 'adm')).rejects.toThrow('não encontrada')
  })

  it('rejeita já decidida', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue({ id: 's1', status: 'APROVADA' })
    await expect(service.rejeitar('s1', 'adm')).rejects.toThrow('já foi decidida')
  })

  it('marca REJEITADA sem tocar no Estado', async () => {
    prisma.solicitacaoMemorial.findUnique.mockResolvedValue({ id: 's1', status: 'PENDENTE' })
    prisma.solicitacaoMemorial.update.mockResolvedValue({ id: 's1', status: 'REJEITADA' })
    await service.rejeitar('s1', 'adm', 'fora do padrão')
    expect(prisma.estado.update).not.toHaveBeenCalled()
    const data = prisma.solicitacaoMemorial.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'REJEITADA', decididoPorId: 'adm', observacaoDecisao: 'fora do padrão' })
  })
})
