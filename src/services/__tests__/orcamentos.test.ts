import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { OrcamentosService } from '../orcamentos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura' }

let prisma: PrismaMock
let service: OrcamentosService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new OrcamentosService(prisma as never)
})

describe('OrcamentosService.listar', () => {
  it('lista por entidade com contagens', async () => {
    prisma.orcamento.findMany.mockResolvedValue([])
    await service.listar('ent1')
    expect(prisma.orcamento.findMany).toHaveBeenCalledWith({
      where: { entidadeId: 'ent1' },
      orderBy: { ano: 'desc' },
      include: { _count: { select: { dotacoes: true, previsoes: true } } },
    })
  })
})

describe('OrcamentosService.buscarPorEntidadeAno', () => {
  it('busca pelo unique entidade+ano', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    await service.buscarPorEntidadeAno('ent1', 2026)
    expect(prisma.orcamento.findUnique).toHaveBeenCalledWith({
      where: { entidadeId_ano: { entidadeId: 'ent1', ano: 2026 } },
    })
  })
})

describe('OrcamentosService.buscarPorId', () => {
  it('inclui entidade e contagens', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    await service.buscarPorId('o1')
    expect(prisma.orcamento.findUnique).toHaveBeenCalledWith({
      where: { id: 'o1' },
      include: {
        entidade: { include: { municipio: { include: { estado: true } } } },
        _count: { select: { dotacoes: true, previsoes: true } },
      },
    })
  })
})

describe('OrcamentosService.criar', () => {
  it('rejeita ano fora do intervalo', async () => {
    await expect(service.criar('ent1', 1800, {})).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('ent1', 99999, {})).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.criar('ent1', 2026.5, {})).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('rejeita quando entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.criar('xx', 2026, {})).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('cria com defaults (sem leiNumero/data)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.create.mockResolvedValue({ id: 'o1' })
    await service.criar('ent1', 2026, {})
    expect(prisma.orcamento.create).toHaveBeenCalledWith({
      data: {
        entidadeId: 'ent1',
        ano: 2026,
        leiNumero: null,
        dataAprovacao: null,
        observacoes: null,
      },
    })
  })

  it('aceita data como string ISO', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.create.mockResolvedValue({ id: 'o1' })
    await service.criar('ent1', 2026, {
      leiNumero: '  Lei 123 ',
      dataAprovacao: '2025-12-20',
      observacoes: '  obs ',
    })
    const data = prisma.orcamento.create.mock.calls[0][0].data
    expect(data.leiNumero).toBe('Lei 123')
    expect(data.observacoes).toBe('obs')
    expect(data.dataAprovacao).toBeInstanceOf(Date)
  })

  it('aceita data como objeto Date', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.create.mockResolvedValue({ id: 'o1' })
    const d = new Date('2025-12-20')
    await service.criar('ent1', 2026, { dataAprovacao: d })
    expect(prisma.orcamento.create.mock.calls[0][0].data.dataAprovacao).toBe(d)
  })

  it('data inválida rejeita', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    await expect(service.criar('ent1', 2026, { dataAprovacao: 'xyz' })).rejects.toMatchObject({
      code: 'REQUISICAO_INVALIDA',
    })
  })

  it('strings vazias viram null', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.create.mockResolvedValue({ id: 'o1' })
    await service.criar('ent1', 2026, { leiNumero: '   ', observacoes: '', dataAprovacao: '' })
    const data = prisma.orcamento.create.mock.calls[0][0].data
    expect(data.leiNumero).toBeNull()
    expect(data.observacoes).toBeNull()
    expect(data.dataAprovacao).toBeNull()
  })

  it('duplicidade vira CONFLITO', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.7.0' }),
    )
    await expect(service.criar('ent1', 2026, {})).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('repassa outros erros', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.orcamento.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar('ent1', 2026, {})).rejects.toThrow('boom')
  })
})

describe('OrcamentosService.atualizar', () => {
  it('404 quando não existe', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', {})).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('bloqueia se EM_EXECUCAO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'EM_EXECUCAO' })
    await expect(service.atualizar('o1', {})).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('atualiza no caminho feliz', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'RASCUNHO' })
    prisma.orcamento.update.mockResolvedValue({ id: 'o1' })
    await service.atualizar('o1', { leiNumero: 'Lei 9' })
    expect(prisma.orcamento.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { leiNumero: 'Lei 9', dataAprovacao: null, observacoes: null },
    })
  })

  it('permite atualizar quando APROVADO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'APROVADO' })
    prisma.orcamento.update.mockResolvedValue({ id: 'o1' })
    await service.atualizar('o1', { observacoes: 'x' })
    expect(prisma.orcamento.update).toHaveBeenCalled()
  })
})

describe('OrcamentosService.alterarStatus', () => {
  it('404 quando não existe', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    await expect(service.alterarStatus('xx', 'ENVIADO_AO_LEGISLATIVO', 'u1')).rejects.toMatchObject({
      code: 'RECURSO_NAO_ENCONTRADO',
    })
  })

  it('RASCUNHO → ENVIADO_AO_LEGISLATIVO grava a transição na trilha (de/para/autor/observação)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'RASCUNHO', dataAprovacao: null, dataPublicacao: null })
    prisma.orcamento.update.mockResolvedValue({ id: 'o1' })
    await service.alterarStatus('o1', 'ENVIADO_AO_LEGISLATIVO', 'u1', 'Encaminhado à Câmara')
    expect(prisma.transicaoStatusOrcamento.create.mock.calls[0][0].data).toMatchObject({
      orcamentoId: 'o1', de: 'RASCUNHO', para: 'ENVIADO_AO_LEGISLATIVO', autorId: 'u1', observacao: 'Encaminhado à Câmara',
    })
    expect(prisma.orcamento.update.mock.calls[0][0].data.status).toBe('ENVIADO_AO_LEGISLATIVO')
  })

  it('ENVIADO_AO_LEGISLATIVO → APROVADO seta dataAprovacao quando não há', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'ENVIADO_AO_LEGISLATIVO', dataAprovacao: null, dataPublicacao: null })
    prisma.orcamento.update.mockResolvedValue({ id: 'o1' })
    await service.alterarStatus('o1', 'APROVADO', 'u1')
    const data = prisma.orcamento.update.mock.calls[0][0].data
    expect(data.status).toBe('APROVADO')
    expect(data.dataAprovacao).toBeInstanceOf(Date)
  })

  it('→ APROVADO preserva dataAprovacao existente', async () => {
    const prev = new Date('2025-12-20')
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'ENVIADO_AO_LEGISLATIVO', dataAprovacao: prev, dataPublicacao: null })
    prisma.orcamento.update.mockResolvedValue({ id: 'o1' })
    await service.alterarStatus('o1', 'APROVADO', 'u1')
    expect(prisma.orcamento.update.mock.calls[0][0].data.dataAprovacao).toBeUndefined()
  })

  it('APROVADO → PUBLICADO seta dataPublicacao quando não há', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'APROVADO', dataAprovacao: new Date(), dataPublicacao: null })
    prisma.orcamento.update.mockResolvedValue({ id: 'o1' })
    await service.alterarStatus('o1', 'PUBLICADO', 'u1')
    const data = prisma.orcamento.update.mock.calls[0][0].data
    expect(data.status).toBe('PUBLICADO')
    expect(data.dataPublicacao).toBeInstanceOf(Date)
  })

  it('ENVIADO_AO_LEGISLATIVO → RASCUNHO permitido (devolução)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'ENVIADO_AO_LEGISLATIVO', dataAprovacao: null, dataPublicacao: null })
    prisma.orcamento.update.mockResolvedValue({ id: 'o1' })
    await service.alterarStatus('o1', 'RASCUNHO', 'u1')
    expect(prisma.orcamento.update.mock.calls[0][0].data.status).toBe('RASCUNHO')
  })

  it('EM_EXECUCAO é estado terminal (não muda por aqui)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'EM_EXECUCAO' })
    await expect(service.alterarStatus('o1', 'PUBLICADO', 'u1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('rejeita transição não permitida (RASCUNHO → APROVADO direto)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'RASCUNHO' })
    await expect(service.alterarStatus('o1', 'APROVADO', 'u1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('EM_EXECUCAO não é alcançável por aqui (só pela abertura contábil)', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'PUBLICADO' })
    await expect(service.alterarStatus('o1', 'EM_EXECUCAO', 'u1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})

describe('OrcamentosService.excluir', () => {
  it('404 quando não existe', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('bloqueia se não RASCUNHO', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'APROVADO',
      _count: { dotacoes: 0, previsoes: 0 },
    })
    await expect(service.excluir('o1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('bloqueia se tem dotações/previsões', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'RASCUNHO',
      _count: { dotacoes: 2, previsoes: 0 },
    })
    await expect(service.excluir('o1')).rejects.toMatchObject({ code: 'CONFLITO' })

    prisma.orcamento.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'RASCUNHO',
      _count: { dotacoes: 0, previsoes: 3 },
    })
    await expect(service.excluir('o1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('exclui no caminho feliz', async () => {
    prisma.orcamento.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'RASCUNHO',
      _count: { dotacoes: 0, previsoes: 0 },
    })
    prisma.orcamento.delete.mockResolvedValue({})
    await service.excluir('o1')
    expect(prisma.orcamento.delete).toHaveBeenCalledWith({ where: { id: 'o1' } })
  })
})
