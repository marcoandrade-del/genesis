import { describe, it, expect, beforeEach } from 'vitest'
import { FavoritosService } from '../favoritos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const USUARIO = { id: 'u1', ativo: true }
const OUTRO_USUARIO = { id: 'u2', ativo: true }
const PASTA = { id: 'p1', nome: 'Trabalho', usuarioId: 'u1', parentId: null }
const PASTA_OUTRO = { id: 'p2', nome: 'Pessoal', usuarioId: 'u2', parentId: null }
const REL_FIXO = { id: 'rf1', nome: 'Férias', sistemaId: 's1' }
const REL_PERS = { id: 'rp1', nome: 'Meu Rel', usuarioId: 'u1' }
const REL_PERS_OUTRO = { id: 'rp2', nome: 'Rel Outro', usuarioId: 'u2' }
const FAVORITO = { id: 'fav1', usuarioId: 'u1', relatorioFixoId: 'rf1', pastaId: null, ordem: 0 }

describe('FavoritosService.listarPastas', () => {
  let prisma: PrismaMock
  let service: FavoritosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new FavoritosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.listarPastas('u-inexistente')).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('retorna pastas raiz do usuário', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.findMany.mockResolvedValue([PASTA])

    const resultado = await service.listarPastas('u1')

    expect(prisma.pastaFavorito.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usuarioId: 'u1', parentId: null } }),
    )
    expect(resultado).toEqual([PASTA])
  })
})

describe('FavoritosService.criarPasta', () => {
  let prisma: PrismaMock
  let service: FavoritosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new FavoritosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.criarPasta('u-inexistente', { nome: 'Nova' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.pastaFavorito.create).not.toHaveBeenCalled()
  })

  it('cria pasta raiz quando parentId não informado', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.create.mockResolvedValue(PASTA)

    await service.criarPasta('u1', { nome: 'Trabalho' })

    expect(prisma.pastaFavorito.create).toHaveBeenCalledWith({
      data: { nome: 'Trabalho', usuarioId: 'u1' },
    })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando pasta pai não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.findUnique.mockResolvedValue(null)

    await expect(service.criarPasta('u1', { nome: 'Sub', parentId: 'p-inexistente' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.pastaFavorito.create).not.toHaveBeenCalled()
  })

  it('lança REQUISICAO_INVALIDA quando pasta pai pertence a outro usuário', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.findUnique.mockResolvedValue(PASTA_OUTRO)

    await expect(service.criarPasta('u1', { nome: 'Sub', parentId: 'p2' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.pastaFavorito.create).not.toHaveBeenCalled()
  })

  it('cria subpasta quando pasta pai válida', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.findUnique.mockResolvedValue(PASTA)
    const subPasta = { ...PASTA, id: 'p3', parentId: 'p1' }
    prisma.pastaFavorito.create.mockResolvedValue(subPasta)

    await service.criarPasta('u1', { nome: 'Sub', parentId: 'p1' })

    expect(prisma.pastaFavorito.create).toHaveBeenCalledWith({
      data: { nome: 'Sub', parentId: 'p1', usuarioId: 'u1' },
    })
  })
})

describe('FavoritosService.excluirPasta', () => {
  let prisma: PrismaMock
  let service: FavoritosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new FavoritosService(prisma as never)
  })

  it('lança CONFLITO quando há subpastas', async () => {
    prisma.pastaFavorito.count.mockResolvedValue(2)

    await expect(service.excluirPasta('p1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.pastaFavorito.delete).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando há favoritos na pasta', async () => {
    prisma.pastaFavorito.count.mockResolvedValue(0)
    prisma.favoritoRelatorio.count.mockResolvedValue(3)

    await expect(service.excluirPasta('p1')).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.pastaFavorito.delete).not.toHaveBeenCalled()
  })

  it('exclui pasta quando está vazia', async () => {
    prisma.pastaFavorito.count.mockResolvedValue(0)
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    prisma.pastaFavorito.delete.mockResolvedValue(PASTA)

    await service.excluirPasta('p1')

    expect(prisma.pastaFavorito.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })
})

describe('FavoritosService.adicionarFavorito', () => {
  let prisma: PrismaMock
  let service: FavoritosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    service = new FavoritosService(prisma as never)
  })

  it('lança RECURSO_NAO_ENCONTRADO quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)

    await expect(service.adicionarFavorito('u-inexistente', { relatorioFixoId: 'rf1' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança REQUISICAO_INVALIDA quando nenhum relatório informado', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)

    await expect(service.adicionarFavorito('u1', {})).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança REQUISICAO_INVALIDA quando ambos os tipos informados', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)

    await expect(service.adicionarFavorito('u1', { relatorioFixoId: 'rf1', relatorioPersonalizadoId: 'rp1' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando relatório fixo não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioFixo.findUnique.mockResolvedValue(null)

    await expect(service.adicionarFavorito('u1', { relatorioFixoId: 'rf-inexistente' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.favoritoRelatorio.create).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando relatório fixo já está nos favoritos', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioFixo.findUnique.mockResolvedValue(REL_FIXO)
    prisma.favoritoRelatorio.findFirst.mockResolvedValue(FAVORITO)

    await expect(service.adicionarFavorito('u1', { relatorioFixoId: 'rf1' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando relatório personalizado não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(null)

    await expect(service.adicionarFavorito('u1', { relatorioPersonalizadoId: 'rp-inexistente' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança REQUISICAO_INVALIDA quando relatório personalizado não pertence ao usuário', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(REL_PERS_OUTRO)

    await expect(service.adicionarFavorito('u1', { relatorioPersonalizadoId: 'rp2' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('lança CONFLITO quando relatório personalizado já está nos favoritos', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(REL_PERS)
    prisma.favoritoRelatorio.findFirst.mockResolvedValue(FAVORITO)

    await expect(service.adicionarFavorito('u1', { relatorioPersonalizadoId: 'rp1' })).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando pasta não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioFixo.findUnique.mockResolvedValue(REL_FIXO)
    prisma.favoritoRelatorio.findFirst.mockResolvedValue(null)
    prisma.pastaFavorito.findUnique.mockResolvedValue(null)

    await expect(service.adicionarFavorito('u1', { relatorioFixoId: 'rf1', pastaId: 'p-inexistente' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })

  it('lança REQUISICAO_INVALIDA quando pasta não pertence ao usuário', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioFixo.findUnique.mockResolvedValue(REL_FIXO)
    prisma.favoritoRelatorio.findFirst.mockResolvedValue(null)
    prisma.pastaFavorito.findUnique.mockResolvedValue(PASTA_OUTRO)

    await expect(service.adicionarFavorito('u1', { relatorioFixoId: 'rf1', pastaId: 'p2' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('adiciona favorito de relatório fixo com sucesso', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioFixo.findUnique.mockResolvedValue(REL_FIXO)
    prisma.favoritoRelatorio.findFirst.mockResolvedValue(null)
    prisma.favoritoRelatorio.create.mockResolvedValue(FAVORITO)

    const resultado = await service.adicionarFavorito('u1', { relatorioFixoId: 'rf1' })

    expect(prisma.favoritoRelatorio.create).toHaveBeenCalledWith({
      data: { relatorioFixoId: 'rf1', usuarioId: 'u1' },
    })
    expect(resultado).toEqual(FAVORITO)
  })
})
