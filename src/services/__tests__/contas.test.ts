import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ContasService, NIVEL_MAX } from '../contas.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PLANO = { id: 'p1', descricao: 'PCASP 2026', ano: 2026, modeloContabilId: 'm1' }
const RAIZ = { id: 'c1', codigo: '1', descricao: 'Ativo', nivel: 1, admiteMovimento: false, planoId: 'p1', parentId: null }
const FOLHA = { id: 'c10', codigo: '1.1.1.01.001', descricao: 'Caixa', nivel: 5, admiteMovimento: true, planoId: 'p1', parentId: 'c9' }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })
const erroP2025 = new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: ContasService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ContasService(prisma as never)
})

describe('NIVEL_MAX', () => {
  it('é 9 conforme spec (PCASP Estendido TCE-PR)', () => {
    expect(NIVEL_MAX).toBe(9)
  })
})

describe('ContasService.listar', () => {
  it('lista contas do plano ordenadas por código', async () => {
    prisma.conta.findMany.mockResolvedValue([RAIZ])
    await service.listar('p1')
    expect(prisma.conta.findMany).toHaveBeenCalledWith({ where: { planoId: 'p1' }, orderBy: { codigo: 'asc' } })
  })
})

describe('ContasService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.conta.findUnique.mockResolvedValue(RAIZ)
    expect(await service.buscarPorId('c1')).toEqual(RAIZ)
  })
})

describe('ContasService.criar', () => {
  it('cria conta raiz (nivel 1, sem parent)', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.create.mockResolvedValue(RAIZ)

    await service.criar({ planoId: 'p1', codigo: '1', descricao: 'Ativo' })

    expect(prisma.conta.create).toHaveBeenCalledWith({
      data: {
        planoId: 'p1', codigo: '1', descricao: 'Ativo',
        nivel: 1, admiteMovimento: false, parentId: null,
      },
    })
  })

  it('cria conta filha com nivel = parent.nivel + 1', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.findUnique.mockResolvedValue({ ...RAIZ, nivel: 3, admiteMovimento: false })
    prisma.conta.create.mockResolvedValue({})

    await service.criar({ planoId: 'p1', codigo: '1.1.1', descricao: 'X', parentId: 'c-pai' })

    const data = prisma.conta.create.mock.calls[0][0].data
    expect(data.nivel).toBe(4)
    expect(data.parentId).toBe('c-pai')
  })

  it('respeita admiteMovimento=true ao criar', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.findUnique.mockResolvedValue({ ...RAIZ, nivel: 5, admiteMovimento: false })
    prisma.conta.create.mockResolvedValue({})

    await service.criar({ planoId: 'p1', codigo: '1.1.1.01.001', descricao: 'Caixa', parentId: 'c-pai', admiteMovimento: true })

    expect(prisma.conta.create.mock.calls[0][0].data.admiteMovimento).toBe(true)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando plano não existe', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(null)
    await expect(service.criar({ planoId: 'xx', codigo: '1', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando parent não existe', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.findUnique.mockResolvedValue(null)
    await expect(service.criar({ planoId: 'p1', codigo: '1.1', descricao: 'X', parentId: 'xx' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança REQUISICAO_INVALIDA quando parent é de outro plano', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.findUnique.mockResolvedValue({ ...RAIZ, planoId: 'p-outro' })
    await expect(service.criar({ planoId: 'p1', codigo: '1.1', descricao: 'X', parentId: 'c-pai' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança CONFLITO ao tentar criar filho de conta que admite movimento', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.findUnique.mockResolvedValue({ ...RAIZ, admiteMovimento: true, nivel: 3 })
    await expect(service.criar({ planoId: 'p1', codigo: '1.1.1.001', descricao: 'X', parentId: 'c-pai' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.conta.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando excede NIVEL_MAX (parent.nivel=9 → filho seria nivel 10)', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.findUnique.mockResolvedValue({ ...RAIZ, nivel: 9, admiteMovimento: false })
    await expect(service.criar({ planoId: 'p1', codigo: 'x', descricao: 'X', parentId: 'c-pai' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('permite criar filho cujo nível resultante é exatamente NIVEL_MAX', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.findUnique.mockResolvedValue({ ...RAIZ, nivel: 8, admiteMovimento: false })
    prisma.conta.create.mockResolvedValue({})
    await service.criar({ planoId: 'p1', codigo: 'x', descricao: 'X', parentId: 'c-pai' })
    expect(prisma.conta.create.mock.calls[0][0].data.nivel).toBe(9)
  })

  it('lança CONFLITO em P2002 (código duplicado no plano)', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.create.mockRejectedValue(erroP2002)
    await expect(service.criar({ planoId: 'p1', codigo: '1', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar({ planoId: 'p1', codigo: '1', descricao: 'X' })).rejects.toThrow('boom')
  })
})

describe('ContasService.atualizar', () => {
  it('atualiza codigo/descricao sem checar filhos quando não muda admiteMovimento', async () => {
    prisma.conta.findUnique.mockResolvedValue(RAIZ)
    prisma.conta.update.mockResolvedValue({ ...RAIZ, descricao: 'Novo' })

    await service.atualizar('c1', { descricao: 'Novo' })

    expect(prisma.conta.count).not.toHaveBeenCalled()
  })

  it('lança RECURSO_NAO_ENCONTRADO quando conta não existe', async () => {
    prisma.conta.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', { descricao: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO ao marcar admiteMovimento=true em conta com filhos', async () => {
    prisma.conta.findUnique.mockResolvedValue({ ...RAIZ, admiteMovimento: false })
    prisma.conta.count.mockResolvedValue(3)
    await expect(service.atualizar('c1', { admiteMovimento: true }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.conta.update).not.toHaveBeenCalled()
  })

  it('permite marcar admiteMovimento=true em folha (sem filhos)', async () => {
    prisma.conta.findUnique.mockResolvedValue({ ...RAIZ, admiteMovimento: false })
    prisma.conta.count.mockResolvedValue(0)
    prisma.conta.update.mockResolvedValue({})
    await service.atualizar('c1', { admiteMovimento: true })
    expect(prisma.conta.update).toHaveBeenCalled()
  })

  it('não checa filhos quando admiteMovimento já era true (idempotente)', async () => {
    prisma.conta.findUnique.mockResolvedValue({ ...FOLHA, admiteMovimento: true })
    prisma.conta.update.mockResolvedValue({})
    await service.atualizar('c10', { admiteMovimento: true })
    expect(prisma.conta.count).not.toHaveBeenCalled()
  })

  it('lança CONFLITO em P2002', async () => {
    prisma.conta.findUnique.mockResolvedValue(RAIZ)
    prisma.conta.update.mockRejectedValue(erroP2002)
    await expect(service.atualizar('c1', { codigo: '1' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO em P2025', async () => {
    prisma.conta.findUnique.mockResolvedValue(RAIZ)
    prisma.conta.update.mockRejectedValue(erroP2025)
    await expect(service.atualizar('c1', { codigo: '1' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.conta.findUnique.mockResolvedValue(RAIZ)
    prisma.conta.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('c1', { codigo: '1' })).rejects.toThrow('boom')
  })

  it('propaga Prisma error com código não tratado', async () => {
    prisma.conta.findUnique.mockResolvedValue(RAIZ)
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.conta.update.mockRejectedValue(erro)
    await expect(service.atualizar('c1', { codigo: '1' })).rejects.toBe(erro)
  })
})

describe('ContasService.excluir', () => {
  beforeEach(() => {
    prisma.conta.findUnique.mockResolvedValue(RAIZ)
    prisma.conta.count.mockResolvedValue(0)
    prisma.lancamentoItem.count.mockResolvedValue(0)
    prisma.resumoMensalConta.count.mockResolvedValue(0)
    prisma.saldoInicialAno.count.mockResolvedValue(0)
  })

  it('exclui folha sem movimento', async () => {
    await service.excluir('c1')
    expect(prisma.conta.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.conta.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO quando há filhos', async () => {
    prisma.conta.count.mockResolvedValue(2)
    await expect(service.excluir('c1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.conta.delete).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando há lançamentos', async () => {
    prisma.lancamentoItem.count.mockResolvedValue(1)
    await expect(service.excluir('c1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando há resumos mensais', async () => {
    prisma.resumoMensalConta.count.mockResolvedValue(1)
    await expect(service.excluir('c1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando há saldos iniciais', async () => {
    prisma.saldoInicialAno.count.mockResolvedValue(1)
    await expect(service.excluir('c1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })
})
