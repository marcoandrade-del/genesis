import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { SolicitacoesAcessoBiService } from '../solicitacoes-acesso-bi.js'

describe('SolicitacoesAcessoBiService', () => {
  let prisma: PrismaMock
  let svc: SolicitacoesAcessoBiService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SolicitacoesAcessoBiService(prisma as never)
  })

  it('solicitar: resolve e-mail→usuário e município→PREFEITURA e cria a solicitação (LEITURA)', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u1' })
    prisma.entidade.findFirst.mockResolvedValue({
      id: 'ent-pref-1',
      municipio: { id: 'mun-1', nome: 'Maringá', estado: { sigla: 'PR' } },
    })
    prisma.acessoEntidade.findUnique.mockResolvedValue(null) // sem acesso vigente
    prisma.solicitacaoAcessoEntidade.findFirst.mockResolvedValue(null) // sem pendência
    prisma.entidade.findUnique.mockResolvedValue({ id: 'ent-pref-1', ativo: true }) // usado pelo criar()
    prisma.solicitacaoAcessoEntidade.create.mockResolvedValue({
      id: 'sol-1',
      status: 'PENDENTE',
      nivelSolicitado: 'LEITURA',
      justificativa: 'preciso acompanhar',
      criadoEm: new Date('2026-07-11T00:00:00Z'),
    })

    const r = await svc.solicitar('gestor@x.gov.br', 'mun-1', 'preciso acompanhar')

    expect(prisma.entidade.findFirst.mock.calls[0]![0].where).toMatchObject({
      municipioId: 'mun-1',
      tipo: 'PREFEITURA',
      ativo: true,
    })
    expect(prisma.solicitacaoAcessoEntidade.create.mock.calls[0]![0].data).toMatchObject({
      usuarioId: 'u1',
      entidadeId: 'ent-pref-1',
      nivelSolicitado: 'LEITURA',
    })
    expect(r).toMatchObject({ id: 'sol-1', status: 'PENDENTE', municipio: { id: 'mun-1', nome: 'Maringá', estado: 'PR' } })
  })

  it('solicitar: e-mail desconhecido → RECURSO_NAO_ENCONTRADO (404)', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    await expect(svc.solicitar('fantasma@x.gov.br', 'mun-1')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('solicitar: município sem prefeitura ativa → RECURSO_NAO_ENCONTRADO (404)', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u1' })
    prisma.entidade.findFirst.mockResolvedValue(null)
    await expect(svc.solicitar('gestor@x.gov.br', 'mun-x')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('listar: só as solicitações de PREFEITURA, mapeadas com o município', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u1' })
    prisma.solicitacaoAcessoEntidade.findMany.mockResolvedValue([
      {
        id: 'sol-1', status: 'PENDENTE', nivelSolicitado: 'LEITURA', justificativa: null, criadoEm: new Date('2026-07-11T00:00:00Z'),
        entidade: { tipo: 'PREFEITURA', municipio: { id: 'mun-1', nome: 'Maringá', estado: { sigla: 'PR' } } },
      },
      {
        id: 'sol-2', status: 'PENDENTE', nivelSolicitado: 'LEITURA', justificativa: null, criadoEm: new Date('2026-07-10T00:00:00Z'),
        entidade: { tipo: 'CAMARA', municipio: { id: 'mun-1', nome: 'Maringá', estado: { sigla: 'PR' } } },
      },
    ])

    const r = await svc.listar('gestor@x.gov.br')

    expect(r).toEqual([
      { id: 'sol-1', status: 'PENDENTE', nivelSolicitado: 'LEITURA', justificativa: null, criadoEm: new Date('2026-07-11T00:00:00Z'), municipio: { id: 'mun-1', nome: 'Maringá', estado: 'PR' } },
    ])
  })

  it('cancelar: resolve o usuário e delega ao serviço (retorna id+status)', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u1' })
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({ id: 'sol-1', usuarioId: 'u1', status: 'PENDENTE' })
    prisma.solicitacaoAcessoEntidade.update.mockResolvedValue({ id: 'sol-1', status: 'CANCELADA' })

    const r = await svc.cancelar('gestor@x.gov.br', 'sol-1')

    expect(r).toEqual({ id: 'sol-1', status: 'CANCELADA' })
  })

  // --- lado do ADMIN do município (aprovação) ---

  const prefeituraDeMun1 = () =>
    prisma.entidade.findFirst.mockResolvedValue({
      id: 'ent-pref-1',
      municipio: { id: 'mun-1', nome: 'Maringá', estado: { sigla: 'PR' } },
    })
  const comoAdmin = () =>
    prisma.acessoEntidade.findUnique.mockResolvedValue({ ativo: true, nivel: 'ADMIN', entidade: { ativo: true } })
  const comoLeitor = () =>
    prisma.acessoEntidade.findUnique.mockResolvedValue({ ativo: true, nivel: 'LEITURA', entidade: { ativo: true } })

  it('listarPendentes: ADMIN vê as pendentes da prefeitura, com o solicitante', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u-admin' })
    prefeituraDeMun1()
    comoAdmin()
    prisma.solicitacaoAcessoEntidade.findMany.mockResolvedValue([
      {
        id: 'sol-1', status: 'PENDENTE', nivelSolicitado: 'LEITURA', justificativa: 'preciso',
        criadoEm: new Date('2026-07-12T00:00:00Z'),
        usuario: { id: 'u-sol', nomeCompleto: 'Fulano', emailPrincipal: 'fulano@x.gov.br' },
      },
    ])

    const r = await svc.listarPendentes('admin@x.gov.br', 'mun-1')

    expect(r).toEqual([
      {
        id: 'sol-1', status: 'PENDENTE', nivelSolicitado: 'LEITURA', justificativa: 'preciso',
        criadoEm: new Date('2026-07-12T00:00:00Z'), municipio: { id: 'mun-1', nome: 'Maringá', estado: 'PR' },
        solicitante: { nome: 'Fulano', email: 'fulano@x.gov.br' },
      },
    ])
  })

  it('listarPendentes: não-ADMIN do município → NAO_AUTORIZADO (403), sem listar', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u-leitor' })
    prefeituraDeMun1()
    comoLeitor()

    await expect(svc.listarPendentes('leitor@x.gov.br', 'mun-1')).rejects.toMatchObject({ code: 'NAO_AUTORIZADO' })
    expect(prisma.solicitacaoAcessoEntidade.findMany).not.toHaveBeenCalled()
  })

  it('aprovar: ADMIN concede o nível SOLICITADO e ativa o acesso', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u-admin' })
    prefeituraDeMun1()
    comoAdmin()
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({
      id: 'sol-1', usuarioId: 'u-sol', entidadeId: 'ent-pref-1', status: 'PENDENTE', nivelSolicitado: 'LEITURA',
    })
    prisma.solicitacaoAcessoEntidade.update.mockResolvedValue({ id: 'sol-1', status: 'APROVADA' })

    const r = await svc.aprovar('admin@x.gov.br', 'mun-1', 'sol-1')

    expect(r).toEqual({ id: 'sol-1', status: 'APROVADA' })
    expect(prisma.acessoEntidade.upsert.mock.calls[0]![0].create).toMatchObject({
      usuarioId: 'u-sol', entidadeId: 'ent-pref-1', nivel: 'LEITURA', ativo: true,
    })
  })

  it('aprovar: não-ADMIN → NAO_AUTORIZADO (403), sem conceder acesso', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u-leitor' })
    prefeituraDeMun1()
    comoLeitor()

    await expect(svc.aprovar('leitor@x.gov.br', 'mun-1', 'sol-1')).rejects.toMatchObject({ code: 'NAO_AUTORIZADO' })
    expect(prisma.acessoEntidade.upsert).not.toHaveBeenCalled()
  })

  it('rejeitar: ADMIN rejeita a pendente (escopo da prefeitura)', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u-admin' })
    prefeituraDeMun1()
    comoAdmin()
    prisma.solicitacaoAcessoEntidade.findUnique.mockResolvedValue({ id: 'sol-1', entidadeId: 'ent-pref-1', status: 'PENDENTE' })
    prisma.solicitacaoAcessoEntidade.update.mockResolvedValue({ id: 'sol-1', status: 'REJEITADA' })

    const r = await svc.rejeitar('admin@x.gov.br', 'mun-1', 'sol-1')

    expect(r).toEqual({ id: 'sol-1', status: 'REJEITADA' })
    expect(prisma.solicitacaoAcessoEntidade.update.mock.calls[0]![0].data).toMatchObject({
      status: 'REJEITADA', decididoPorId: 'u-admin',
    })
  })
})
