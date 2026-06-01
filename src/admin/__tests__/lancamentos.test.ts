import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarMock, buscarPorIdMock, excluirMock, criarMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  buscarPorIdMock: vi.fn(),
  excluirMock: vi.fn(),
  criarMock: vi.fn(),
}))

vi.mock('../../services/lancamentos.js', async () => {
  // Mantém o `extrairAnoMes` real — o admin importa para validar a data.
  const real = await vi.importActual<typeof import('../../services/lancamentos.js')>(
    '../../services/lancamentos.js',
  )
  return {
    ...real,
    LancamentosService: class {
      listar = listarMock
      buscarPorId = buscarPorIdMock
      excluir = excluirMock
      criar = criarMock
    },
  }
})

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminLancamentosRoutes } from '../lancamentos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ESTADO = { id: 'e1', sigla: 'MG', nome: 'Minas Gerais' }
const MUNICIPIO = { id: 'mun1', nome: 'Belo Horizonte', estado: ESTADO }
const ENTIDADE = {
  id: 'ent1',
  nome: 'Prefeitura de Belo Horizonte',
  tipo: 'PREFEITURA',
  municipioId: 'mun1',
  municipio: MUNICIPIO,
}
const LANCAMENTO = {
  id: 'l1',
  entidadeId: 'ent1',
  data: new Date('2026-05-20T00:00:00Z'),
  historico: 'Pagamento de fornecedor',
  valor: '1500.00',
  criadoEm: new Date(),
  criadoPorId: 'u1',
  itens: [
    { id: 'i1', lancamentoId: 'l1', contaId: 'c1', tipo: 'DEBITO', valor: '1500.00' },
    { id: 'i2', lancamentoId: 'l1', contaId: 'c2', tipo: 'CREDITO', valor: '1500.00' },
  ],
}

describe('adminLancamentosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;[listarMock, buscarPorIdMock, excluirMock, criarMock].forEach((m) => m.mockReset())
    ;({ app, prisma } = await criarApp({
      registrar: adminLancamentosRoutes,
      comView: true,
      simularAdmin: { sub: 'a1', email: 'a@x.com' },
    }))
  })

  describe('GET /', () => {
    it('sem filtros mostra picker e instrução', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione estado, município e entidade')
      expect(prisma.municipio.findMany).not.toHaveBeenCalled()
      expect(prisma.entidade.findMany).not.toHaveBeenCalled()
      expect(listarMock).not.toHaveBeenCalled()
    })

    it('com estadoId mostra select de municípios filtrado', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      prisma.municipio.findMany.mockResolvedValue([{ id: 'mun1', nome: 'Belo Horizonte' }])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1' })
      expect(prisma.municipio.findMany).toHaveBeenCalledWith({
        where: { estadoId: 'e1' },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true },
      })
      expect(res.body).toContain('Belo Horizonte')
    })

    it('com municipioId carrega entidades ativas', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.municipio.findMany.mockResolvedValue([])
      prisma.entidade.findMany.mockResolvedValue([{ id: 'ent1', nome: 'Prefeitura', tipo: 'PREFEITURA' }])
      const res = await app.inject({ method: 'GET', url: '/?estadoId=e1&municipioId=mun1' })
      expect(prisma.entidade.findMany).toHaveBeenCalledWith({
        where: { municipioId: 'mun1', ativo: true },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true, tipo: true },
      })
      expect(res.body).toContain('Prefeitura')
    })

    it('ignora estadoId vazio (whitespace)', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?estadoId=%20' })
      expect(prisma.municipio.findMany).not.toHaveBeenCalled()
    })

    it('com entidade lista lançamentos', async () => {
      prisma.estado.findMany.mockResolvedValue([ESTADO])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([LANCAMENTO])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=ent1' })
      expect(res.statusCode).toBe(200)
      expect(listarMock).toHaveBeenCalledWith('ent1', {})
      expect(res.body).toContain('Pagamento de fornecedor')
    })

    it('aplica filtros de data quando informados', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([])
      await app.inject({
        method: 'GET',
        url: '/?entidadeId=ent1&dataInicio=2026-01-01&dataFim=2026-12-31',
      })
      expect(listarMock).toHaveBeenCalledWith('ent1', { dataInicio: '2026-01-01', dataFim: '2026-12-31' })
    })

    it('omite filtros vazios da chamada ao service', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([])
      await app.inject({ method: 'GET', url: '/?entidadeId=ent1&dataInicio=%20&dataFim=' })
      expect(listarMock).toHaveBeenCalledWith('ent1', {})
    })

    it('estado vazio quando entidade sem lançamentos no período', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=ent1' })
      expect(res.body).toContain('Nenhum lançamento no período')
    })

    it('mostra aviso de limite atingido quando 500 retornados', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      listarMock.mockResolvedValue(Array(500).fill(LANCAMENTO))
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=ent1' })
      expect(res.body).toContain('limite 500 atingido')
    })

    it('ignora entidadeId quando entidade não existe (não chama service)', async () => {
      prisma.estado.findMany.mockResolvedValue([])
      prisma.entidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/?entidadeId=xx' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Selecione estado')
      expect(listarMock).not.toHaveBeenCalled()
    })
  })

  describe('GET /:id/detalhe', () => {
    it('404 quando lançamento não existe', async () => {
      buscarPorIdMock.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/x/detalhe' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza modal com itens e contas', async () => {
      buscarPorIdMock.mockResolvedValue(LANCAMENTO)
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      prisma.contaContabilEntidade.findMany.mockResolvedValue([
        { id: 'c1', codigo: '1.1.1.1.1.01.00', descricao: 'CAIXA' },
        { id: 'c2', codigo: '2.1.3.1.1.01.00', descricao: 'FORNECEDORES' },
      ])
      const res = await app.inject({ method: 'GET', url: '/l1/detalhe' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('CAIXA')
      expect(res.body).toContain('FORNECEDORES')
      expect(res.body).toContain('Débito')
      expect(res.body).toContain('Crédito')
    })

    it('mostra placeholder quando conta referenciada não existe mais', async () => {
      buscarPorIdMock.mockResolvedValue(LANCAMENTO)
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      prisma.contaContabilEntidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/l1/detalhe' })
      expect(res.body).toContain('&lt;conta removida&gt;')
    })

    it('renderiza com entidade null sem quebrar', async () => {
      buscarPorIdMock.mockResolvedValue(LANCAMENTO)
      prisma.entidade.findUnique.mockResolvedValue(null)
      prisma.contaContabilEntidade.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/l1/detalhe' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /ano-vigente', () => {
    it('sem entidadeId/data renderiza placeholder', async () => {
      const res = await app.inject({ method: 'GET', url: '/ano-vigente' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Defina uma data')
      expect(prisma.contaContabilEntidade.count).not.toHaveBeenCalled()
    })

    it('com contas no ano mostra badge verde + hidden ano', async () => {
      prisma.contaContabilEntidade.count.mockResolvedValue(42)
      const res = await app.inject({ method: 'GET', url: '/ano-vigente?entidadeId=ent1&data=2026-05-20' })
      expect(prisma.contaContabilEntidade.count).toHaveBeenCalledWith({
        where: { entidadeId: 'ent1', ano: 2026, admiteMovimento: true },
      })
      expect(res.body).toContain('Exercício 2026')
      expect(res.body).toContain('42 conta')
      expect(res.body).toContain('value="2026"')
    })

    it('sem contas para o ano mostra alerta', async () => {
      prisma.contaContabilEntidade.count.mockResolvedValue(0)
      const res = await app.inject({ method: 'GET', url: '/ano-vigente?entidadeId=ent1&data=2030-01-15' })
      expect(res.body).toContain('Sem contas de movimento para 2030')
    })

    it('data inválida não quebra — trata como sem ano', async () => {
      const res = await app.inject({ method: 'GET', url: '/ano-vigente?entidadeId=ent1&data=xx' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Defina uma data')
    })
  })

  describe('GET /novo', () => {
    it('sem entidadeId redireciona para listagem', async () => {
      const res = await app.inject({ method: 'GET', url: '/novo' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/admin/lancamentos')
    })

    it('com entidade inexistente devolve 404', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/novo?entidadeId=xx' })
      expect(res.statusCode).toBe(404)
    })

    it('renderiza form com entidade e ano vigente para hoje', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      prisma.contaContabilEntidade.count.mockResolvedValue(50)
      const res = await app.inject({ method: 'GET', url: '/novo?entidadeId=ent1' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Novo Lançamento')
      expect(res.body).toContain('Prefeitura de Belo Horizonte')
    })
  })

  describe('POST /', () => {
    const body = (overrides: Record<string, string | string[]> = {}) => {
      const base = {
        entidadeId: 'ent1',
        data: '2026-05-20',
        historico: 'Pagamento de fornecedor',
        tipo: ['DEBITO', 'CREDITO'],
        contaId: ['c1', 'c2'],
        valor: ['100.00', '100.00'],
        ...overrides,
      }
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(base)) {
        if (Array.isArray(v)) v.forEach((x) => params.append(k, x))
        else params.append(k, v)
      }
      return params.toString()
    }

    const post = (formBody: string) =>
      app.inject({
        method: 'POST',
        url: '/',
        payload: formBody,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })

    it('cria lançamento e devolve HX-Redirect', async () => {
      criarMock.mockResolvedValue({ id: 'l1' })
      const res = await post(body())
      expect(res.statusCode).toBe(204)
      expect(res.headers['hx-redirect']).toBe('/admin/lancamentos?entidadeId=ent1')
      expect(criarMock).toHaveBeenCalledWith({
        entidadeId: 'ent1',
        data: '2026-05-20',
        historico: 'Pagamento de fornecedor',
        itens: [
          { tipo: 'DEBITO', contaId: 'c1', valor: '100.00' },
          { tipo: 'CREDITO', contaId: 'c2', valor: '100.00' },
        ],
        criadoPorId: 'a1',
      })
    })

    it('rejeita sem itens', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await post(body({ tipo: [], contaId: [], valor: [] }))
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Adicione ao menos 1 débito e 1 crédito')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('rejeita tipo inválido', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await post(body({ tipo: ['XYZ', 'CREDITO'] }))
      expect(res.body).toContain('Tipo inválido')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('rejeita conta vazia', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await post(body({ contaId: ['', 'c2'] }))
      expect(res.body).toContain('conta selecionada')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('rejeita valor não-positivo', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await post(body({ valor: ['0', '100.00'] }))
      expect(res.body).toContain('valor positivo')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('rejeita historico vazio', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await post(body({ historico: '   ' }))
      expect(res.body).toContain('Histórico é obrigatório')
    })

    it('rejeita entidadeId vazio com 400', async () => {
      const res = await post(body({ entidadeId: '   ' }))
      expect(res.statusCode).toBe(400)
      expect(res.body).toContain('Entidade não informada')
      expect(criarMock).not.toHaveBeenCalled()
    })

    it('rejeita data vazia', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await post(body({ data: '' }))
      expect(res.body).toContain('Data é obrigatória')
    })

    it('arrays de tamanhos diferentes → erro de inconsistência', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const res = await post(
        body({ tipo: ['DEBITO', 'CREDITO'], contaId: ['c1'], valor: ['100', '100'] }),
      )
      expect(res.body).toContain('inconsistentes')
    })

    it('erro do service vira mensagem na view', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      criarMock.mockRejectedValue(new Error('Conta "1.1" pertence a outra entidade.'))
      const res = await post(body())
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('outra entidade')
    })

    it('erro não-Error usa mensagem default', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      criarMock.mockRejectedValue('boom')
      const res = await post(body())
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Erro ao criar lançamento')
    })

    it('POST sem campo data exercita fallbacks de reRenderErro', async () => {
      // historico ausente também → ?? '' em ambos. data ausente → data ?? ''
      // no regex e dataPadrao fica = hoje.
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      const params = new URLSearchParams()
      params.append('entidadeId', 'ent1')
      // sem data, sem historico — mas com 2 itens válidos para chegar à
      // checagem de data e cair no reRenderErro com data/historico undefined.
      params.append('tipo', 'DEBITO')
      params.append('tipo', 'CREDITO')
      params.append('contaId', 'c1')
      params.append('contaId', 'c2')
      params.append('valor', '100')
      params.append('valor', '100')
      const res = await app.inject({
        method: 'POST',
        url: '/',
        payload: params.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Data é obrigatória')
    })

    it('arrays mais curtos que tipos preenchem com string vazia', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      // 2 tipos, 1 contaId, 1 valor → cai em "inconsistentes", mas o
      // reRenderErro mapeia tipos (2) e busca contaIds[1]/valores[1]
      // (undefined → ?? '').
      const res = await post(
        body({ tipo: ['DEBITO', 'CREDITO'], contaId: ['c1'], valor: ['100'] }),
      )
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('inconsistentes')
    })
  })

  describe('DELETE /:id', () => {
    it('exclui com 200', async () => {
      excluirMock.mockResolvedValue(undefined)
      const res = await app.inject({ method: 'DELETE', url: '/l1' })
      expect(res.statusCode).toBe(200)
      expect(excluirMock).toHaveBeenCalledWith('l1')
    })

    it('400 quando service rejeita com Error', async () => {
      excluirMock.mockRejectedValue(new Error('Não encontrado'))
      const res = await app.inject({ method: 'DELETE', url: '/l1' })
      expect(res.statusCode).toBe(400)
      expect(res.body).toBe('Não encontrado')
    })

    it('400 com mensagem default para erro não-Error', async () => {
      excluirMock.mockRejectedValue('boom')
      const res = await app.inject({ method: 'DELETE', url: '/l1' })
      expect(res.body).toBe('Erro ao excluir.')
    })
  })
})
