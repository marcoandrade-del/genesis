import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ContasReceitaService, NIVEL_MAX_RECEITA } from '../contas-receita.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PLANO = { id: 'pr1', descricao: 'Receita PR 2026', ano: 2026, modeloContabilId: 'm1' }
const RAIZ = { id: 'c1', codigo: '1', descricao: 'Receitas Correntes', nivel: 1, admiteMovimento: false, planoId: 'pr1', parentId: null }
const FOLHA = { id: 'c10', codigo: '1.1.1.2.01.1.1', descricao: 'IPTU', nivel: 7, admiteMovimento: true, planoId: 'pr1', parentId: 'c9' }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })
const erroP2025 = new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: ContasReceitaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ContasReceitaService(prisma as never)
})

describe('NIVEL_MAX_RECEITA', () => {
  it('é 12 (TCEs estendem a natureza de receita)', () => {
    expect(NIVEL_MAX_RECEITA).toBe(12)
  })
})

describe('ContasReceitaService.listar', () => {
  it('lista contas do plano ordenadas por código', async () => {
    prisma.contaReceita.findMany.mockResolvedValue([RAIZ])
    await service.listar('pr1')
    expect(prisma.contaReceita.findMany).toHaveBeenCalledWith({ where: { planoId: 'pr1' }, orderBy: { codigo: 'asc' } })
  })
})

describe('ContasReceitaService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
    expect(await service.buscarPorId('c1')).toEqual(RAIZ)
  })
})

describe('ContasReceitaService.criar', () => {
  it('cria conta raiz (nivel 1, sem parent)', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.create.mockResolvedValue(RAIZ)

    await service.criar({ planoId: 'pr1', codigo: '1', descricao: 'Receitas Correntes' })

    expect(prisma.contaReceita.create).toHaveBeenCalledWith({
      data: {
        planoId: 'pr1', codigo: '1', descricao: 'Receitas Correntes',
        nivel: 1, admiteMovimento: false, parentId: null,
      },
    })
  })

  it('cria conta filha com nivel = parent.nivel + 1', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, nivel: 3, admiteMovimento: false })
    prisma.contaReceita.create.mockResolvedValue({})

    await service.criar({ planoId: 'pr1', codigo: '1.1.1', descricao: 'X', parentId: 'c-pai' })

    const data = prisma.contaReceita.create.mock.calls[0][0].data
    expect(data.nivel).toBe(4)
    expect(data.parentId).toBe('c-pai')
  })

  it('respeita admiteMovimento=true ao criar', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, nivel: 6, admiteMovimento: false })
    prisma.contaReceita.create.mockResolvedValue({})

    await service.criar({ planoId: 'pr1', codigo: '1.1.1.2.01.1', descricao: 'IPTU', parentId: 'c-pai', admiteMovimento: true })

    expect(prisma.contaReceita.create.mock.calls[0][0].data.admiteMovimento).toBe(true)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando plano não existe', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(null)
    await expect(service.criar({ planoId: 'xx', codigo: '1', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando parent não existe', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.findUnique.mockResolvedValue(null)
    await expect(service.criar({ planoId: 'pr1', codigo: '1.1', descricao: 'X', parentId: 'xx' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança REQUISICAO_INVALIDA quando parent é de outro plano', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, planoId: 'p-outro' })
    await expect(service.criar({ planoId: 'pr1', codigo: '1.1', descricao: 'X', parentId: 'c-pai' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança CONFLITO ao tentar criar filho de conta que admite movimento', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, admiteMovimento: true, nivel: 3 })
    await expect(service.criar({ planoId: 'pr1', codigo: '1.1.1.001', descricao: 'X', parentId: 'c-pai' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaReceita.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando excede NIVEL_MAX_RECEITA (parent.nivel=12 → filho 13)', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, nivel: 12, admiteMovimento: false })
    await expect(service.criar({ planoId: 'pr1', codigo: 'x', descricao: 'X', parentId: 'c-pai' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('permite criar filho cujo nível resultante é exatamente NIVEL_MAX_RECEITA', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, nivel: 11, admiteMovimento: false })
    prisma.contaReceita.create.mockResolvedValue({})
    await service.criar({ planoId: 'pr1', codigo: 'x', descricao: 'X', parentId: 'c-pai' })
    expect(prisma.contaReceita.create.mock.calls[0][0].data.nivel).toBe(12)
  })

  it('lança CONFLITO em P2002 (código duplicado no plano)', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.create.mockRejectedValue(erroP2002)
    await expect(service.criar({ planoId: 'pr1', codigo: '1', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar({ planoId: 'pr1', codigo: '1', descricao: 'X' })).rejects.toThrow('boom')
  })
})

describe('ContasReceitaService.atualizar', () => {
  it('atualiza codigo/descricao sem checar filhos quando não muda admiteMovimento', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
    prisma.contaReceita.update.mockResolvedValue({ ...RAIZ, descricao: 'Novo' })

    await service.atualizar('c1', { descricao: 'Novo' })

    expect(prisma.contaReceita.count).not.toHaveBeenCalled()
  })

  it('lança RECURSO_NAO_ENCONTRADO quando conta não existe', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', { descricao: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO ao marcar admiteMovimento=true em conta com filhos', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, admiteMovimento: false })
    prisma.contaReceita.count.mockResolvedValue(3)
    await expect(service.atualizar('c1', { admiteMovimento: true }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaReceita.update).not.toHaveBeenCalled()
  })

  it('permite marcar admiteMovimento=true em folha (sem filhos)', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue({ ...RAIZ, admiteMovimento: false })
    prisma.contaReceita.count.mockResolvedValue(0)
    prisma.contaReceita.update.mockResolvedValue({})
    await service.atualizar('c1', { admiteMovimento: true })
    expect(prisma.contaReceita.update).toHaveBeenCalled()
  })

  it('não checa filhos quando admiteMovimento já era true (idempotente)', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue({ ...FOLHA, admiteMovimento: true })
    prisma.contaReceita.update.mockResolvedValue({})
    await service.atualizar('c10', { admiteMovimento: true })
    expect(prisma.contaReceita.count).not.toHaveBeenCalled()
  })

  it('lança CONFLITO em P2002', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
    prisma.contaReceita.update.mockRejectedValue(erroP2002)
    await expect(service.atualizar('c1', { codigo: '1' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO em P2025', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
    prisma.contaReceita.update.mockRejectedValue(erroP2025)
    await expect(service.atualizar('c1', { codigo: '1' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
    prisma.contaReceita.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('c1', { codigo: '1' })).rejects.toThrow('boom')
  })

  it('propaga Prisma error com código não tratado', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.contaReceita.update.mockRejectedValue(erro)
    await expect(service.atualizar('c1', { codigo: '1' })).rejects.toBe(erro)
  })
})

describe('ContasReceitaService.excluir', () => {
  it('exclui folha sem filhos', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
    prisma.contaReceita.count.mockResolvedValue(0)
    await service.excluir('c1')
    expect(prisma.contaReceita.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO quando há filhos', async () => {
    prisma.contaReceita.findUnique.mockResolvedValue(RAIZ)
    prisma.contaReceita.count.mockResolvedValue(2)
    await expect(service.excluir('c1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaReceita.delete).not.toHaveBeenCalled()
  })
})
