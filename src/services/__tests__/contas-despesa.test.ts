import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ContasDespesaService, NIVEL_MAX_DESPESA } from '../contas-despesa.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PLANO = { id: 'pd1', descricao: 'Despesa PR 2026', ano: 2026, modeloContabilId: 'm1' }
const RAIZ = { id: 'c1', codigo: '3', descricao: 'Despesas Correntes', nivel: 1, admiteMovimento: false, planoId: 'pd1', parentId: null }
const FOLHA = { id: 'c10', codigo: '3.1.20.41.01', descricao: 'Contribuições', nivel: 5, admiteMovimento: true, planoId: 'pd1', parentId: 'c9' }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })
const erroP2025 = new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: ContasDespesaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ContasDespesaService(prisma as never)
})

describe('NIVEL_MAX_DESPESA', () => {
  it('é 10 (natureza da despesa + desdobramentos)', () => {
    expect(NIVEL_MAX_DESPESA).toBe(10)
  })
})

describe('ContasDespesaService.listar', () => {
  it('lista contas do plano ordenadas por código', async () => {
    prisma.contaDespesa.findMany.mockResolvedValue([RAIZ])
    await service.listar('pd1')
    expect(prisma.contaDespesa.findMany).toHaveBeenCalledWith({ where: { planoId: 'pd1' }, orderBy: { codigo: 'asc' } })
  })
})

describe('ContasDespesaService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(RAIZ)
    expect(await service.buscarPorId('c1')).toEqual(RAIZ)
  })
})

describe('ContasDespesaService.criar', () => {
  it('cria conta raiz (nivel 1, sem parent)', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.create.mockResolvedValue(RAIZ)

    await service.criar({ planoId: 'pd1', codigo: '3', descricao: 'Despesas Correntes' })

    expect(prisma.contaDespesa.create).toHaveBeenCalledWith({
      data: {
        planoId: 'pd1', codigo: '3', descricao: 'Despesas Correntes',
        nivel: 1, admiteMovimento: true, parentId: null,
      },
    })
  })

  it('cria conta filha com nivel = parent.nivel + 1', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.findUnique.mockResolvedValue({ ...RAIZ, nivel: 3, admiteMovimento: false })
    prisma.contaDespesa.create.mockResolvedValue({})

    await service.criar({ planoId: 'pd1', codigo: '3.1.20', descricao: 'X', parentId: 'c-pai' })

    const data = prisma.contaDespesa.create.mock.calls[0][0].data
    expect(data.nivel).toBe(4)
    expect(data.parentId).toBe('c-pai')
  })

  it('toda conta nasce analítica; criar filho torna o pai sintética', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.findUnique.mockResolvedValue({ ...RAIZ, nivel: 4, admiteMovimento: true })
    prisma.contaDespesa.create.mockResolvedValue({ id: 'cN', parentId: 'c-pai', nivel: 5, admiteMovimento: true })

    await service.criar({ planoId: 'pd1', codigo: '3.1.20.41.01', descricao: 'Contribuições', parentId: 'c-pai' })

    expect(prisma.contaDespesa.create.mock.calls[0][0].data.admiteMovimento).toBe(true)
    expect(prisma.contaDespesa.update).toHaveBeenCalledWith({ where: { id: 'c-pai' }, data: { admiteMovimento: false } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando plano não existe', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(null)
    await expect(service.criar({ planoId: 'xx', codigo: '3', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando parent não existe', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.findUnique.mockResolvedValue(null)
    await expect(service.criar({ planoId: 'pd1', codigo: '3.1', descricao: 'X', parentId: 'xx' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança REQUISICAO_INVALIDA quando parent é de outro plano', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.findUnique.mockResolvedValue({ ...RAIZ, planoId: 'p-outro' })
    await expect(service.criar({ planoId: 'pd1', codigo: '3.1', descricao: 'X', parentId: 'c-pai' }))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança CONFLITO quando excede NIVEL_MAX_DESPESA (parent.nivel=10 → filho 11)', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.findUnique.mockResolvedValue({ ...RAIZ, nivel: 10, admiteMovimento: false })
    await expect(service.criar({ planoId: 'pd1', codigo: 'x', descricao: 'X', parentId: 'c-pai' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('permite criar filho cujo nível resultante é exatamente NIVEL_MAX_DESPESA', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.findUnique.mockResolvedValue({ ...RAIZ, nivel: 9, admiteMovimento: false })
    prisma.contaDespesa.create.mockResolvedValue({})
    await service.criar({ planoId: 'pd1', codigo: 'x', descricao: 'X', parentId: 'c-pai' })
    expect(prisma.contaDespesa.create.mock.calls[0][0].data.nivel).toBe(10)
  })

  it('lança CONFLITO em P2002 (código duplicado no plano)', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.create.mockRejectedValue(erroP2002)
    await expect(service.criar({ planoId: 'pd1', codigo: '3', descricao: 'X' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar({ planoId: 'pd1', codigo: '3', descricao: 'X' })).rejects.toThrow('boom')
  })
})

describe('ContasDespesaService.atualizar', () => {
  it('atualiza codigo/descricao sem checar filhos quando não muda admiteMovimento', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(RAIZ)
    prisma.contaDespesa.update.mockResolvedValue({ ...RAIZ, descricao: 'Novo' })

    await service.atualizar('c1', { descricao: 'Novo' })

    expect(prisma.contaDespesa.count).not.toHaveBeenCalled()
  })

  it('lança RECURSO_NAO_ENCONTRADO quando conta não existe', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(null)
    await expect(service.atualizar('xx', { descricao: 'X' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO ao marcar admiteMovimento=true em conta com filhos', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue({ ...RAIZ, admiteMovimento: false })
    prisma.contaDespesa.count.mockResolvedValue(3)
    await expect(service.atualizar('c1', { admiteMovimento: true }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaDespesa.update).not.toHaveBeenCalled()
  })

  it('permite marcar admiteMovimento=true em folha (sem filhos)', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue({ ...RAIZ, admiteMovimento: false })
    prisma.contaDespesa.count.mockResolvedValue(0)
    prisma.contaDespesa.update.mockResolvedValue({})
    await service.atualizar('c1', { admiteMovimento: true })
    expect(prisma.contaDespesa.update).toHaveBeenCalled()
  })

  it('não checa filhos quando admiteMovimento já era true (idempotente)', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue({ ...FOLHA, admiteMovimento: true })
    prisma.contaDespesa.update.mockResolvedValue({})
    await service.atualizar('c10', { admiteMovimento: true })
    expect(prisma.contaDespesa.count).not.toHaveBeenCalled()
  })

  it('lança CONFLITO em P2002', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(RAIZ)
    prisma.contaDespesa.update.mockRejectedValue(erroP2002)
    await expect(service.atualizar('c1', { codigo: '3' }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO em P2025', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(RAIZ)
    prisma.contaDespesa.update.mockRejectedValue(erroP2025)
    await expect(service.atualizar('c1', { codigo: '3' }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(RAIZ)
    prisma.contaDespesa.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('c1', { codigo: '3' })).rejects.toThrow('boom')
  })

  it('propaga Prisma error com código não tratado', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(RAIZ)
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.contaDespesa.update.mockRejectedValue(erro)
    await expect(service.atualizar('c1', { codigo: '3' })).rejects.toBe(erro)
  })
})

describe('ContasDespesaService.excluir', () => {
  it('exclui folha sem filhos', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(RAIZ)
    prisma.contaDespesa.count.mockResolvedValue(0)
    await service.excluir('c1')
    expect(prisma.contaDespesa.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança CONFLITO quando há filhos', async () => {
    prisma.contaDespesa.findUnique.mockResolvedValue(RAIZ)
    prisma.contaDespesa.count.mockResolvedValue(2)
    await expect(service.excluir('c1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaDespesa.delete).not.toHaveBeenCalled()
  })
})
