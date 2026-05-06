import { describe, it, expect, beforeEach } from 'vitest'
import { RelatoriosService } from '../relatorios.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const SISTEMA_ATIVO = { id: 's1', nome: 'RH', ativo: true }
const SISTEMA_INATIVO = { id: 's2', nome: 'Folha', ativo: false }
const USUARIO_ATIVO = { id: 'u1', ativo: true }
const USUARIO_INATIVO = { id: 'u2', ativo: false }
const REL_FIXO = { id: 'rf1', nome: 'Férias', sistemaId: 's1', ativo: true }
const REL_PERS = { id: 'rp1', nome: 'Meu Rel', usuarioId: 'u1', ativo: true }

describe('RelatoriosService.listarFixos', () => {
  let prisma: PrismaMock
  let service: RelatoriosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new RelatoriosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)

    await expect(service.listarFixos('s-inexistente')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('retorna relatórios fixos do sistema', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA_ATIVO)
    prisma.relatorioFixo.findMany.mockResolvedValue([REL_FIXO])

    const resultado = await service.listarFixos('s1')

    expect(prisma.relatorioFixo.findMany).toHaveBeenCalledWith({ where: { sistemaId: 's1' }, orderBy: { nome: 'asc' } })
    expect(resultado).toEqual([REL_FIXO])
  })
})

describe('RelatoriosService.criarFixo', () => {
  let prisma: PrismaMock
  let service: RelatoriosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new RelatoriosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)

    await expect(service.criarFixo('s-inexistente', { nome: 'X', rota: '/x' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.relatorioFixo.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando sistema está inativo', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA_INATIVO)

    await expect(service.criarFixo('s2', { nome: 'X', rota: '/x' })).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.relatorioFixo.create).not.toHaveBeenCalled()
  })

  it('cria relatório fixo com sucesso', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA_ATIVO)
    prisma.relatorioFixo.create.mockResolvedValue(REL_FIXO)

    const resultado = await service.criarFixo('s1', { nome: 'Férias', rota: '/ferias' })

    expect(prisma.relatorioFixo.create).toHaveBeenCalledWith({
      data: { nome: 'Férias', rota: '/ferias', sistemaId: 's1' },
    })
    expect(resultado).toEqual(REL_FIXO)
  })
})

describe('RelatoriosService.excluirFixo', () => {
  let prisma: PrismaMock
  let service: RelatoriosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new RelatoriosService(prisma as never)
  })

  it('lança CONFLITO quando há favoritos vinculados', async () => {
    prisma.favoritoRelatorio.count.mockResolvedValue(2)

    await expect(service.excluirFixo('rf1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.relatorioFixo.delete).not.toHaveBeenCalled()
  })

  it('exclui relatório fixo quando não há favoritos vinculados', async () => {
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    prisma.relatorioFixo.delete.mockResolvedValue(REL_FIXO)

    await service.excluirFixo('rf1')

    expect(prisma.relatorioFixo.delete).toHaveBeenCalledWith({ where: { id: 'rf1' } })
  })
})

describe('RelatoriosService.listarPersonalizados', () => {
  let prisma: PrismaMock
  let service: RelatoriosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new RelatoriosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.listarPersonalizados('u-inexistente')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('retorna relatórios personalizados do usuário', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
    prisma.relatorioPersonalizado.findMany.mockResolvedValue([REL_PERS])

    const resultado = await service.listarPersonalizados('u1')

    expect(resultado).toEqual([REL_PERS])
  })
})

describe('RelatoriosService.criarPersonalizado', () => {
  let prisma: PrismaMock
  let service: RelatoriosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new RelatoriosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.criarPersonalizado('u-inexistente', { nome: 'X', configuracao: {} })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.relatorioPersonalizado.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando usuário está inativo', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_INATIVO)

    await expect(service.criarPersonalizado('u2', { nome: 'X', configuracao: {} })).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.relatorioPersonalizado.create).not.toHaveBeenCalled()
  })

  it('cria relatório personalizado com sucesso', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO_ATIVO)
    prisma.relatorioPersonalizado.create.mockResolvedValue(REL_PERS)

    const resultado = await service.criarPersonalizado('u1', { nome: 'Meu Rel', configuracao: { col: 'nome' } })

    expect(prisma.relatorioPersonalizado.create).toHaveBeenCalledWith({
      data: { nome: 'Meu Rel', configuracao: { col: 'nome' }, usuarioId: 'u1' },
    })
    expect(resultado).toEqual(REL_PERS)
  })
})

describe('RelatoriosService.excluirPersonalizado', () => {
  let prisma: PrismaMock
  let service: RelatoriosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new RelatoriosService(prisma as never)
  })

  it('lança CONFLITO quando há favoritos vinculados', async () => {
    prisma.favoritoRelatorio.count.mockResolvedValue(1)

    await expect(service.excluirPersonalizado('rp1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.relatorioPersonalizado.delete).not.toHaveBeenCalled()
  })

  it('exclui relatório personalizado quando não há favoritos', async () => {
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    prisma.relatorioPersonalizado.delete.mockResolvedValue(REL_PERS)

    await service.excluirPersonalizado('rp1')

    expect(prisma.relatorioPersonalizado.delete).toHaveBeenCalledWith({ where: { id: 'rp1' } })
  })
})
