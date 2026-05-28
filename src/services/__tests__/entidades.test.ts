import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { EntidadeService } from '../entidades.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const MUNICIPIO = { id: 'mun1', nome: 'Curitiba', modeloContabilId: 'm1', estado: { modeloContabilId: 'mEstado' } }
const ENTIDADE = { id: 'ent1', nome: 'Prefeitura de Curitiba', tipo: 'PREFEITURA', cnpj: null, municipioId: 'mun1', ativo: true }

const erroP2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' })
const erroP2025 = new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: '7.0.0' })

let prisma: PrismaMock
let service: EntidadeService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new EntidadeService(prisma as never)
})

describe('EntidadeService.listar', () => {
  it('sem filtro lista tudo ordenado por nome', async () => {
    prisma.entidade.findMany.mockResolvedValue([ENTIDADE])
    expect(await service.listar()).toEqual([ENTIDADE])
    expect(prisma.entidade.findMany).toHaveBeenCalledWith({ where: undefined, orderBy: { nome: 'asc' } })
  })

  it('filtra por municipioId', async () => {
    prisma.entidade.findMany.mockResolvedValue([])
    await service.listar('mun1')
    expect(prisma.entidade.findMany).toHaveBeenCalledWith({ where: { municipioId: 'mun1' }, orderBy: { nome: 'asc' } })
  })
})

describe('EntidadeService.buscarPorId', () => {
  it('busca pelo id', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    expect(await service.buscarPorId('ent1')).toEqual(ENTIDADE)
  })
})

describe('EntidadeService.criar', () => {
  const PLANO = { id: 'p' }
  const CONTAS_CONT = [
    { id: 'cc1', codigo: '1', descricao: 'Ativo', nivel: 1, admiteMovimento: false, parentId: null },
    { id: 'cc2', codigo: '1.1', descricao: 'Caixa', nivel: 2, admiteMovimento: true, parentId: 'cc1' },
  ]
  const FONTES = [{ id: 'f1', codigo: '500', nomenclatura: 'Livres', especificacao: null, vinculada: false, grupo: 'Livres' }]

  function planosOk() {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    prisma.planoDeContas.findFirst.mockResolvedValue(PLANO)
    prisma.planoContasReceita.findFirst.mockResolvedValue(PLANO)
    prisma.planoContasDespesa.findFirst.mockResolvedValue(PLANO)
    prisma.fonteRecurso.findMany.mockResolvedValue(FONTES)
    prisma.conta.findMany.mockResolvedValue(CONTAS_CONT)
    prisma.contaReceita.findMany.mockResolvedValue([])
    prisma.contaDespesa.findMany.mockResolvedValue([])
    prisma.entidade.create.mockResolvedValue(ENTIDADE)
  }

  it('cria entidade e copia a árvore contábil remapeando parentId + origem MODELO', async () => {
    planosOk()
    const r = await service.criar({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: 2026 })
    expect(r).toEqual(ENTIDADE)

    expect(prisma.entidade.create).toHaveBeenCalledWith({
      data: { municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA' },
    })
    const data = prisma.contaContabilEntidade.createMany.mock.calls[0][0].data
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({ entidadeId: 'ent1', ano: 2026, codigo: '1', origem: 'MODELO', modeloContaId: 'cc1', parentId: null })
    // o filho aponta para o NOVO id do pai (não o id do modelo)
    expect(data[1].parentId).toBe(data[0].id)
    expect(data[1]).toMatchObject({ modeloContaId: 'cc2', admiteMovimento: true })
  })

  it('copia as três árvores quando todas existem', async () => {
    planosOk()
    prisma.contaReceita.findMany.mockResolvedValue([{ id: 'r1', codigo: '1', descricao: 'Rec', nivel: 1, admiteMovimento: true, parentId: null }])
    prisma.contaDespesa.findMany.mockResolvedValue([{ id: 'd1', codigo: '3', descricao: 'Desp', nivel: 1, admiteMovimento: true, parentId: null }])
    await service.criar({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: 2026 })
    expect(prisma.contaContabilEntidade.createMany).toHaveBeenCalled()
    expect(prisma.contaReceitaEntidade.createMany.mock.calls[0][0].data[0]).toMatchObject({ codigo: '1', modeloContaId: 'r1', origem: 'MODELO' })
    expect(prisma.contaDespesaEntidade.createMany.mock.calls[0][0].data[0]).toMatchObject({ codigo: '3', modeloContaId: 'd1', origem: 'MODELO' })
  })

  it('copia fontes com origem MODELO + modeloFonteId', async () => {
    planosOk()
    await service.criar({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: 2026 })
    const data = prisma.fonteRecursoEntidade.createMany.mock.calls[0][0].data
    expect(data[0]).toMatchObject({ entidadeId: 'ent1', ano: 2026, codigo: '500', origem: 'MODELO', modeloFonteId: 'f1', vinculada: false })
  })

  it('inclui cnpj quando informado', async () => {
    planosOk()
    await service.criar({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: 2026, cnpj: '12.345.678/0001-99' })
    expect(prisma.entidade.create).toHaveBeenCalledWith({
      data: { municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', cnpj: '12.345.678/0001-99' },
    })
  })

  it('usa modelo herdado do estado quando município não tem modelo próprio', async () => {
    prisma.municipio.findUnique.mockResolvedValue({ ...MUNICIPIO, modeloContabilId: null })
    prisma.planoDeContas.findFirst.mockResolvedValue(null)
    prisma.planoContasReceita.findFirst.mockResolvedValue(null)
    prisma.planoContasDespesa.findFirst.mockResolvedValue(null)
    prisma.fonteRecurso.findMany.mockResolvedValue([])
    prisma.entidade.create.mockResolvedValue(ENTIDADE)
    await service.criar({ municipioId: 'mun1', nome: 'Câmara', tipo: 'CAMARA', ano: 2026 })
    expect(prisma.planoDeContas.findFirst).toHaveBeenCalledWith({ where: { modeloContabilId: 'mEstado', ano: 2026 } })
  })

  it('não chama createMany quando os planos/fontes não existem', async () => {
    prisma.municipio.findUnique.mockResolvedValue(MUNICIPIO)
    prisma.planoDeContas.findFirst.mockResolvedValue(null)
    prisma.planoContasReceita.findFirst.mockResolvedValue(null)
    prisma.planoContasDespesa.findFirst.mockResolvedValue(null)
    prisma.fonteRecurso.findMany.mockResolvedValue([])
    prisma.entidade.create.mockResolvedValue(ENTIDADE)
    await service.criar({ municipioId: 'mun1', nome: 'X', tipo: 'ADM_INDIRETA', ano: 2026 })
    expect(prisma.contaContabilEntidade.createMany).not.toHaveBeenCalled()
    expect(prisma.contaReceitaEntidade.createMany).not.toHaveBeenCalled()
    expect(prisma.contaDespesaEntidade.createMany).not.toHaveBeenCalled()
    expect(prisma.fonteRecursoEntidade.createMany).not.toHaveBeenCalled()
  })

  it('lança RECURSO_NAO_ENCONTRADO quando município não existe', async () => {
    prisma.municipio.findUnique.mockResolvedValue(null)
    await expect(service.criar({ municipioId: 'xx', nome: 'X', tipo: 'PREFEITURA', ano: 2026 }))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança ENTIDADE_NAO_PROCESSAVEL quando município e estado não têm modelo', async () => {
    prisma.municipio.findUnique.mockResolvedValue({ ...MUNICIPIO, modeloContabilId: null, estado: { modeloContabilId: null } })
    await expect(service.criar({ municipioId: 'mun1', nome: 'X', tipo: 'PREFEITURA', ano: 2026 }))
      .rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    expect(prisma.entidade.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO em P2002 (nome/cnpj duplicado)', async () => {
    planosOk()
    prisma.entidade.create.mockRejectedValue(erroP2002)
    await expect(service.criar({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: 2026 }))
      .rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga erros não-Prisma', async () => {
    planosOk()
    prisma.entidade.create.mockRejectedValue(new Error('boom'))
    await expect(service.criar({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: 2026 }))
      .rejects.toThrow('boom')
  })
})

describe('EntidadeService.atualizar', () => {
  it('atualiza com sucesso', async () => {
    prisma.entidade.update.mockResolvedValue({ ...ENTIDADE, nome: 'Novo' })
    const r = await service.atualizar('ent1', { nome: 'Novo', ativo: false })
    expect(r.nome).toBe('Novo')
    expect(prisma.entidade.update).toHaveBeenCalledWith({ where: { id: 'ent1' }, data: { nome: 'Novo', ativo: false } })
  })

  it('lança CONFLITO em P2002', async () => {
    prisma.entidade.update.mockRejectedValue(erroP2002)
    await expect(service.atualizar('ent1', { cnpj: 'x' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO em P2025', async () => {
    prisma.entidade.update.mockRejectedValue(erroP2025)
    await expect(service.atualizar('ent1', { nome: 'Y' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('propaga erros não-Prisma', async () => {
    prisma.entidade.update.mockRejectedValue(new Error('boom'))
    await expect(service.atualizar('ent1', { nome: 'Y' })).rejects.toThrow('boom')
  })

  it('propaga Prisma error com código não tratado', async () => {
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.entidade.update.mockRejectedValue(erro)
    await expect(service.atualizar('ent1', { nome: 'Y' })).rejects.toBe(erro)
  })
})

describe('EntidadeService.excluir', () => {
  it('exclui a entidade e suas cópias', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    await service.excluir('ent1')
    expect(prisma.contaContabilEntidade.deleteMany).toHaveBeenCalledWith({ where: { entidadeId: 'ent1' } })
    expect(prisma.contaReceitaEntidade.deleteMany).toHaveBeenCalledWith({ where: { entidadeId: 'ent1' } })
    expect(prisma.contaDespesaEntidade.deleteMany).toHaveBeenCalledWith({ where: { entidadeId: 'ent1' } })
    expect(prisma.fonteRecursoEntidade.deleteMany).toHaveBeenCalledWith({ where: { entidadeId: 'ent1' } })
    expect(prisma.entidade.delete).toHaveBeenCalledWith({ where: { id: 'ent1' } })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.excluir('xx')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.entidade.delete).not.toHaveBeenCalled()
  })
})
