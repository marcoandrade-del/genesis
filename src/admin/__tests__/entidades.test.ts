import { describe, it, expect, beforeEach, vi } from 'vitest'

const { criarMock, atualizarMock, excluirMock, abrirMock } = vi.hoisted(() => ({
  criarMock: vi.fn(),
  atualizarMock: vi.fn(),
  excluirMock: vi.fn(),
  abrirMock: vi.fn(),
}))

vi.mock('../../services/entidades.js', () => ({
  EntidadeService: class {
    criar = criarMock
    atualizar = atualizarMock
    excluir = excluirMock
  },
}))
vi.mock('../../services/abertura-exercicio.js', () => ({
  AberturaExercicioService: class {
    abrir = abrirMock
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminEntidadesRoutes } from '../entidades.js'
import { ErroNegocio } from '../../errors.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const MUNICIPIO = { id: 'mun1', nome: 'Curitiba', estado: { sigla: 'PR' } }
const ENTIDADE = {
  id: 'ent1', nome: 'Prefeitura de Curitiba', tipo: 'PREFEITURA', cnpj: null, municipioId: 'mun1', ano: 2026, ativo: true,
  municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } },
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('adminEntidadesRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[criarMock, atualizarMock, excluirMock, abrirMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminEntidadesRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
    prisma.municipio.findMany.mockResolvedValue([MUNICIPIO])
  })

  describe('GET /', () => {
    it('lista sem filtro com dropdown de planos POR exercício aberto', async () => {
      prisma.entidade.findMany.mockResolvedValue([ENTIDADE])
      // exercícios com cópias vêm das tabelas de cópia (distinct entidadeId+ano)
      prisma.contaContabilEntidade.findMany.mockResolvedValue([
        { entidadeId: 'ent1', ano: 2026 },
        { entidadeId: 'ent1', ano: 2027 },
      ])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Prefeitura de Curitiba')
      // Planos ▾ → um bloco por exercício, do mais novo para o mais antigo
      expect(res.body).toContain('/admin/contas-contabil-entidade?entidadeId=ent1&ano=2027')
      expect(res.body).toContain('/admin/contas-contabil-entidade?entidadeId=ent1&ano=2026')
      expect(res.body).toContain('/admin/contas-receita-entidade?entidadeId=ent1&ano=2026')
      expect(res.body).toContain('/admin/contas-despesa-entidade?entidadeId=ent1&ano=2026')
      expect(res.body.indexOf('ano=2027')).toBeLessThan(res.body.indexOf('ano=2026'))
      expect(prisma.entidade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }))
    })

    it('entidade sem cópias mostra dropdown vazio e botão de abrir exercício', async () => {
      prisma.entidade.findMany.mockResolvedValue([ENTIDADE])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nenhum exercício com cópias.')
      expect(res.body).toContain('/admin/entidades/ent1/abrir-exercicio/form')
    })

    it('exibe a mensagem de sucesso vinda do redirect (?msg=)', async () => {
      prisma.entidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/?msg=' + encodeURIComponent('Exercício 2027 aberto') })
      expect(res.body).toContain('Exercício 2027 aberto')
    })

    it('filtra por município', async () => {
      prisma.entidade.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?municipioId=mun1' })
      expect(prisma.entidade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { municipioId: 'mun1' } }))
    })

    it('estado vazio quando não há entidades', async () => {
      prisma.entidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.body).toContain('Nenhuma entidade cadastrada')
    })
  })

  describe('GET /form', () => {
    it('renderiza form novo com municípios', async () => {
      const res = await app.inject({ method: 'GET', url: '/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Nova Entidade')
      expect(res.body).toContain('copia as árvores')
    })
  })

  describe('GET /:id/form', () => {
    it('404 quando não existe', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/form' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form de edição com município readonly', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await app.inject({ method: 'GET', url: '/ent1/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Editar Entidade')
      expect(res.body).toContain('não pode ser alterado')
    })
  })

  describe('POST /', () => {
    it('cria e redireciona (dispara cópia)', async () => {
      criarMock.mockResolvedValue(ENTIDADE)
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: '2026', cnpj: '12.345.678/0001-99' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/entidades')
      expect(criarMock).toHaveBeenCalledWith({ municipioId: 'mun1', nome: 'Prefeitura', tipo: 'PREFEITURA', ano: 2026, cnpj: '12.345.678/0001-99' })
    })

    it('cria sem cnpj', async () => {
      criarMock.mockResolvedValue(ENTIDADE)
      await app.inject({
        method: 'POST', url: '/',
        ...form({ municipioId: 'mun1', nome: 'Câmara', tipo: 'CAMARA', ano: '2026', cnpj: '' }),
      })
      expect(criarMock).toHaveBeenCalledWith({ municipioId: 'mun1', nome: 'Câmara', tipo: 'CAMARA', ano: 2026 })
    })

    it('erro quando município não selecionado', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: '', nome: 'X', tipo: 'PREFEITURA', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('Selecione um município')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('erro quando nome vazio', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: '  ', tipo: 'PREFEITURA', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('O nome é obrigatório')
    })

    it('erro quando tipo inválido', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: 'X', tipo: 'FOO', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('Selecione o tipo')
    })

    it('erro quando ano inválido', async () => {
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: 'X', tipo: 'PREFEITURA', ano: 'foo', cnpj: '' }),
      })
      expect(res.body).toContain('Ano (exercício) inválido')
    })

    it('re-renderiza erro do service (ex.: sem modelo)', async () => {
      criarMock.mockRejectedValue(new Error('Município (e seu estado) não têm modelo contábil definido.'))
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: 'X', tipo: 'PREFEITURA', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('não têm modelo contábil')
    })

    it('mensagem default para erro não-Error', async () => {
      criarMock.mockRejectedValue('boom')
      const res = await app.inject({
        method: 'POST', url: '/', ...form({ municipioId: 'mun1', nome: 'X', tipo: 'PREFEITURA', ano: '2026', cnpj: '' }),
      })
      expect(res.body).toContain('Erro ao criar entidade')
    })

    it('passa brasao (logotipo) quando é data URL válido', async () => {
      criarMock.mockResolvedValue(ENTIDADE)
      await app.inject({
        method: 'POST', url: '/',
        ...form({ municipioId: 'mun1', nome: 'Pref', tipo: 'PREFEITURA', ano: '2026', cnpj: '', brasao: 'data:image/png;base64,AAAA' }),
      })
      expect(criarMock).toHaveBeenCalledWith(expect.objectContaining({ brasao: 'data:image/png;base64,AAAA' }))
    })

    it('rejeita brasao que não é imagem', async () => {
      const res = await app.inject({
        method: 'POST', url: '/',
        ...form({ municipioId: 'mun1', nome: 'Pref', tipo: 'PREFEITURA', ano: '2026', cnpj: '', brasao: 'javascript:alert(1)' }),
      })
      expect(res.body).toContain('Brasão inválido')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('brasao vazio vira null (sem logotipo)', async () => {
      criarMock.mockResolvedValue(ENTIDADE)
      await app.inject({
        method: 'POST', url: '/',
        ...form({ municipioId: 'mun1', nome: 'Pref', tipo: 'PREFEITURA', ano: '2026', cnpj: '', brasao: '' }),
      })
      expect(criarMock).toHaveBeenCalledWith(expect.objectContaining({ brasao: null }))
    })
  })

  describe('PUT /:id', () => {
    it('atualiza e redireciona', async () => {
      atualizarMock.mockResolvedValue(ENTIDADE)
      const res = await app.inject({
        method: 'PUT', url: '/ent1', ...form({ nome: 'Novo nome', tipo: 'CAMARA', cnpj: '', ativo: 'true' }),
      })
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/entidades')
      expect(atualizarMock).toHaveBeenCalledWith('ent1', { nome: 'Novo nome', tipo: 'CAMARA', cnpj: null, ativo: true, assinaturaModo: 'MANUAL' })
    })

    it('atualiza com cnpj preenchido', async () => {
      atualizarMock.mockResolvedValue(ENTIDADE)
      await app.inject({
        method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '11.111.111/0001-11' }),
      })
      expect(atualizarMock).toHaveBeenCalledWith('ent1', { nome: 'X', tipo: 'PREFEITURA', cnpj: '11.111.111/0001-11', ativo: false, assinaturaModo: 'MANUAL' })
    })

    it('atualiza definindo o brasao (logotipo)', async () => {
      atualizarMock.mockResolvedValue(ENTIDADE)
      await app.inject({
        method: 'PUT', url: '/ent1',
        ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '', brasao: 'data:image/jpeg;base64,/9j/AAAA' }),
      })
      expect(atualizarMock).toHaveBeenCalledWith('ent1', expect.objectContaining({ brasao: 'data:image/jpeg;base64,/9j/AAAA' }))
    })

    it('remove o brasao quando enviado vazio', async () => {
      atualizarMock.mockResolvedValue(ENTIDADE)
      await app.inject({
        method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '', brasao: '' }),
      })
      expect(atualizarMock).toHaveBeenCalledWith('ent1', expect.objectContaining({ brasao: null }))
    })

    it('grava o modo de assinatura eletrônica', async () => {
      atualizarMock.mockResolvedValue(ENTIDADE)
      await app.inject({
        method: 'PUT', url: '/ent1',
        ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '', assinaturaModo: 'ELETRONICA' }),
      })
      expect(atualizarMock).toHaveBeenCalledWith('ent1', expect.objectContaining({ assinaturaModo: 'ELETRONICA' }))
    })

    it('rejeita brasao inválido no update', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await app.inject({
        method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '', brasao: 'not-an-image' }),
      })
      expect(res.body).toContain('Brasão inválido')
      expect(atualizarMock).not.toHaveBeenCalled()
    })

    it('erro quando nome vazio', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await app.inject({ method: 'PUT', url: '/ent1', ...form({ nome: '', tipo: 'PREFEITURA', cnpj: '' }) })
      expect(res.body).toContain('O nome é obrigatório')
      expect(atualizarMock).not.toHaveBeenCalled()
    })

    it('erro quando tipo inválido', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await app.inject({ method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'ZZZ', cnpj: '' }) })
      expect(res.body).toContain('Tipo inválido')
    })

    it('re-renderiza erro do service', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      atualizarMock.mockRejectedValue(new Error('Nome ou CNPJ já em uso.'))
      const res = await app.inject({ method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '' }) })
      expect(res.body).toContain('já em uso')
    })

    it('mensagem default para erro não-Error', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      atualizarMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'PUT', url: '/ent1', ...form({ nome: 'X', tipo: 'PREFEITURA', cnpj: '' }) })
      expect(res.body).toContain('Erro ao atualizar entidade')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/ent1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('ent1')
    })

    it('400 quando service rejeita com Error', async () => {
      excluirMock.mockRejectedValue(new Error('Em uso'))
      const res = await app.inject({ method: 'DELETE', url: '/ent1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Em uso')
    })

    it('400 com mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('x')
      const res = await app.inject({ method: 'DELETE', url: '/ent1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Erro ao excluir.')
    })
  })

  describe('Abrir exercício', () => {
    beforeEach(() => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    })

    it('GET form sugere o ano seguinte ao último exercício aberto', async () => {
      prisma.contaContabilEntidade.findMany.mockResolvedValue([{ entidadeId: 'ent1', ano: 2026 }])
      const res = await app.inject({ method: 'GET', url: '/ent1/abrir-exercicio/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Abrir exercício')
      expect(res.body).toContain('value="2027"') // 2026 aberto → sugere 2027
      expect(res.body).toContain('2026') // badge do exercício já aberto
    })

    it('GET form sem cópias sugere o ano corrente', async () => {
      const res = await app.inject({ method: 'GET', url: '/ent1/abrir-exercicio/form' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain(`value="${new Date().getFullYear()}"`)
      expect(res.body).toContain('ainda não tem nenhum exercício')
    })

    it('GET form 404 para entidade inexistente', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      expect((await app.inject({ method: 'GET', url: '/x/abrir-exercicio/form' })).statusCode).toBe(404)
    })

    it('POST abre o exercício e redireciona com o resumo na mensagem', async () => {
      abrirMock.mockResolvedValue({ entidadeId: 'ent1', nome: 'Prefeitura de Curitiba', ano: 2027, contabil: 8760, receita: 1808, despesa: 3902, fontes: 3 })
      const res = await app.inject({ method: 'POST', url: '/ent1/abrir-exercicio', ...form({ ano: '2027' }) })
      expect(res.statusCode).toBe(204)
      expect(abrirMock).toHaveBeenCalledWith('ent1', 2027)
      const destino = decodeURIComponent(String(res.headers['hx-redirect']))
      expect(destino).toContain('/admin/entidades?msg=')
      expect(destino).toContain('8760 conta(s)')
    })

    it('POST com ErroNegocio reabre o modal com a mensagem', async () => {
      abrirMock.mockRejectedValue(new ErroNegocio('CONFLITO', 'O exercício 2026 já está aberto para esta entidade. Para atualizar as cópias, use "Ressincronizar".'))
      const res = await app.inject({ method: 'POST', url: '/ent1/abrir-exercicio', ...form({ ano: '2026' }) })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('já está aberto')
      expect(res.body).toContain('value="2026"') // ano digitado repreenchido
    })

    it('POST sem corpo: ano NaN vai ao service e o modal reabre com o ano corrente sugerido', async () => {
      abrirMock.mockRejectedValue(new ErroNegocio('REQUISICAO_INVALIDA', 'Informe um exercício (ano) válido.'))
      const res = await app.inject({ method: 'POST', url: '/ent1/abrir-exercicio' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Informe um exercício')
      expect(res.body).toContain(`value="${new Date().getFullYear()}"`)
      expect(abrirMock).toHaveBeenCalledWith('ent1', NaN)
    })

    it('POST 404 para entidade inexistente; erro inesperado propaga (500)', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      expect((await app.inject({ method: 'POST', url: '/x/abrir-exercicio', ...form({ ano: '2027' }) })).statusCode).toBe(404)
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      abrirMock.mockRejectedValue(new Error('boom'))
      expect((await app.inject({ method: 'POST', url: '/ent1/abrir-exercicio', ...form({ ano: '2027' }) })).statusCode).toBe(500)
    })
  })
})
