import { describe, it, expect, beforeEach } from 'vitest'
import { SolicitacoesAcessoService } from '../solicitacoes-acesso.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: SolicitacoesAcessoService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new SolicitacoesAcessoService(prisma as never)
})

function dadosOk(over: Partial<Record<string, unknown>> = {}) {
  return { usuarioId: 'u1', entidadeId: 'ent1', nivelSolicitado: 'LEITURA', ...over } as never
}

describe('SolicitacoesAcessoService.criar', () => {
  it('rejeita usuarioId ausente', async () => {
    await expect(service.criar(dadosOk({ usuarioId: undefined }))).rejects.toThrow('usuarioId')
  })

  it('rejeita entidadeId ausente', async () => {
    await expect(service.criar(dadosOk({ entidadeId: undefined }))).rejects.toThrow('entidadeId')
  })

  it('rejeita nível inválido', async () => {
    await expect(service.criar(dadosOk({ nivelSolicitado: 'CHEFE' }))).rejects.toThrow('Nível inválido')
  })

  it('rejeita entidade inexistente', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.criar(dadosOk())).rejects.toThrow('não encontrada ou inativa')
  })

  it('rejeita entidade inativa', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1', ativo: false })
    await expect(service.criar(dadosOk())).rejects.toThrow('não encontrada ou inativa')
  })

  it('rejeita quando já tem acesso ativo', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1', ativo: true })
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1', ativo: true })
    await expect(service.criar(dadosOk())).rejects.toThrow('já tem acesso')
  })

  it('rejeita quando já há solicitação pendente', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1', ativo: true })
    prisma.acessoEntidade.findUnique.mockResolvedValue(null)
    prisma.solicitacaoAcessoEntidade.findFirst.mockResolvedValue({ id: 's1' })
    await expect(service.criar(dadosOk())).rejects.toThrow('pendente')
  })

  it('cria com justificativa (acesso vigente inativo é permitido)', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1', ativo: true })
    prisma.acessoEntidade.findUnique.mockResolvedValue({ id: 'a1', ativo: false })
    prisma.solicitacaoAcessoEntidade.findFirst.mockResolvedValue(null)
    prisma.solicitacaoAcessoEntidade.create.mockResolvedValue({ id: 's1' })
    await service.criar(dadosOk({ nivelSolicitado: 'ESCRITA', justificativa: '  preciso lançar  ' }))
    expect(prisma.solicitacaoAcessoEntidade.create).toHaveBeenCalledWith({
      data: {
        usuarioId: 'u1',
        entidadeId: 'ent1',
        nivelSolicitado: 'ESCRITA',
        justificativa: 'preciso lançar',
      },
    })
  })

  it('cria sem justificativa (vira null)', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent1', ativo: true })
    prisma.acessoEntidade.findUnique.mockResolvedValue(null)
    prisma.solicitacaoAcessoEntidade.findFirst.mockResolvedValue(null)
    prisma.solicitacaoAcessoEntidade.create.mockResolvedValue({ id: 's1' })
    await service.criar(dadosOk({ justificativa: '   ' }))
    expect(prisma.solicitacaoAcessoEntidade.create.mock.calls[0][0].data.justificativa).toBeNull()
  })
})

describe('SolicitacoesAcessoService.listarMinhas', () => {
  it('lista as do usuário, mais recentes primeiro', async () => {
    prisma.solicitacaoAcessoEntidade.findMany.mockResolvedValue([])
    await service.listarMinhas('u1')
    expect(prisma.solicitacaoAcessoEntidade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usuarioId: 'u1' }, orderBy: { criadoEm: 'desc' } }),
    )
  })
})

describe('SolicitacoesAcessoService.listarPendentes', () => {
  it('lista só PENDENTE, mais antigas primeiro', async () => {
    prisma.solicitacaoAcessoEntidade.findMany.mockResolvedValue([])
    await service.listarPendentes()
    expect(prisma.solicitacaoAcessoEntidade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDENTE' }, orderBy: { criadoEm: 'asc' } }),
    )
  })
})

describe('SolicitacoesAcessoService.cancelar', () => {
  it('rejeita inexistente', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue(null)
    await expect(service.cancelar('s1', 'u1')).rejects.toThrow('não encontrada')
  })

  it('rejeita de outro usuário', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({ id: 's1', usuarioId: 'u2', status: 'PENDENTE' })
    await expect(service.cancelar('s1', 'u1')).rejects.toThrow('não encontrada')
  })

  it('rejeita quando não está pendente', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({ id: 's1', usuarioId: 'u1', status: 'APROVADA' })
    await expect(service.cancelar('s1', 'u1')).rejects.toThrow('pendente')
  })

  it('cancela a própria pendente', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({ id: 's1', usuarioId: 'u1', status: 'PENDENTE' })
    prisma.solicitacaoAcessoEntidade.update.mockResolvedValue({ id: 's1', status: 'CANCELADA' })
    await service.cancelar('s1', 'u1')
    expect(prisma.solicitacaoAcessoEntidade.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'CANCELADA' },
    })
  })
})

describe('SolicitacoesAcessoService.aprovar', () => {
  it('rejeita nível concedido inválido', async () => {
    await expect(service.aprovar('s1', 'adm', 'CHEFE')).rejects.toThrow('Nível inválido')
  })

  it('rejeita inexistente', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue(null)
    await expect(service.aprovar('s1', 'adm', 'LEITURA')).rejects.toThrow('não encontrada')
  })

  it('rejeita já decidida', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({ id: 's1', status: 'REJEITADA' })
    await expect(service.aprovar('s1', 'adm', 'LEITURA')).rejects.toThrow('já foi decidida')
  })

  it('cria o acesso no nível concedido e marca APROVADA (com observação)', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({
      id: 's1',
      usuarioId: 'u1',
      entidadeId: 'ent1',
      status: 'PENDENTE',
    })
    prisma.acessoEntidade.upsert.mockResolvedValue({ id: 'a1' })
    prisma.solicitacaoAcessoEntidade.update.mockResolvedValue({ id: 's1', status: 'APROVADA' })
    await service.aprovar('s1', 'adm', 'ESCRITA', '  ok  ')
    expect(prisma.acessoEntidade.upsert).toHaveBeenCalledWith({
      where: { usuarioId_entidadeId: { usuarioId: 'u1', entidadeId: 'ent1' } },
      create: { usuarioId: 'u1', entidadeId: 'ent1', nivel: 'ESCRITA', ativo: true },
      update: { nivel: 'ESCRITA', ativo: true },
    })
    const data = prisma.solicitacaoAcessoEntidade.update.mock.calls[0][0].data
    expect(data).toMatchObject({
      status: 'APROVADA',
      nivelConcedido: 'ESCRITA',
      decididoPorId: 'adm',
      observacaoDecisao: 'ok',
    })
    expect(data.decididoEm).toBeInstanceOf(Date)
  })

  it('aprova sem observação (null)', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({
      id: 's1',
      usuarioId: 'u1',
      entidadeId: 'ent1',
      status: 'PENDENTE',
    })
    prisma.acessoEntidade.upsert.mockResolvedValue({ id: 'a1' })
    prisma.solicitacaoAcessoEntidade.update.mockResolvedValue({ id: 's1', status: 'APROVADA' })
    await service.aprovar('s1', 'adm', 'LEITURA')
    expect(prisma.solicitacaoAcessoEntidade.update.mock.calls[0][0].data.observacaoDecisao).toBeNull()
  })
})

describe('SolicitacoesAcessoService.rejeitar', () => {
  it('rejeita inexistente', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue(null)
    await expect(service.rejeitar('s1', 'adm')).rejects.toThrow('não encontrada')
  })

  it('rejeita já decidida', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({ id: 's1', status: 'APROVADA' })
    await expect(service.rejeitar('s1', 'adm')).rejects.toThrow('já foi decidida')
  })

  it('marca REJEITADA sem observação (null)', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({ id: 's1', status: 'PENDENTE' })
    prisma.solicitacaoAcessoEntidade.update.mockResolvedValue({ id: 's1', status: 'REJEITADA' })
    await service.rejeitar('s1', 'adm')
    const data = prisma.solicitacaoAcessoEntidade.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'REJEITADA', decididoPorId: 'adm', observacaoDecisao: null })
  })

  it('marca REJEITADA com observação (trim)', async () => {
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({ id: 's1', status: 'PENDENTE' })
    prisma.solicitacaoAcessoEntidade.update.mockResolvedValue({ id: 's1', status: 'REJEITADA' })
    await service.rejeitar('s1', 'adm', '  fora do escopo  ')
    const data = prisma.solicitacaoAcessoEntidade.update.mock.calls[0][0].data
    expect(data.observacaoDecisao).toBe('fora do escopo')
  })
})
