import { describe, it, expect, beforeEach, vi } from 'vitest'

const { listarPorUsuarioMock, podeAcessarMock } = vi.hoisted(() => ({
  listarPorUsuarioMock: vi.fn(),
  podeAcessarMock: vi.fn(),
}))

vi.mock('../../services/acessos-entidade.js', () => ({
  AcessosEntidadeService: class {
    listarPorUsuario = listarPorUsuarioMock
    listarPorEntidade = vi.fn()
    buscarPorId = vi.fn()
    usuarioPodeAcessar = podeAcessarMock
    conceder = vi.fn()
    atualizar = vi.fn()
    revogar = vi.fn()
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appContextoRoutes, parseContextoCookie } from '../contexto.js'
import type { FastifyInstance } from 'fastify'

const ACESSO_BASE = {
  id: 'a1',
  entidadeId: 'ent1',
  nivel: 'ESCRITA' as const,
  entidade: {
    id: 'ent1',
    nome: 'Prefeitura',
    municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } },
  },
}

function form(obj: Record<string, string>) {
  return {
    payload: new URLSearchParams(obj).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

describe('parseContextoCookie', () => {
  it('parseia formato válido', () => {
    expect(parseContextoCookie('ent1:2026')).toEqual({ entidadeId: 'ent1', ano: 2026 })
  })
  it('null para undefined', () => {
    expect(parseContextoCookie(undefined)).toBeNull()
  })
  it('null para string vazia', () => {
    expect(parseContextoCookie('')).toBeNull()
  })
  it('null para formato sem :', () => {
    expect(parseContextoCookie('ent1')).toBeNull()
  })
  it('null para ano não numérico', () => {
    expect(parseContextoCookie('ent1:xx')).toBeNull()
  })
  it('null para ano fora do intervalo', () => {
    expect(parseContextoCookie('ent1:1800')).toBeNull()
    expect(parseContextoCookie('ent1:99999')).toBeNull()
  })
  it('null para entidadeId vazio', () => {
    expect(parseContextoCookie(':2026')).toBeNull()
  })
})

describe('appContextoRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    listarPorUsuarioMock.mockReset()
    podeAcessarMock.mockReset()
    ;({ app } = await criarApp({
      registrar: appContextoRoutes,
      comView: true,
      simularUsuario: { sub: 'u1', email: 'u@x.com' },
    }))
  })

  describe('GET /contexto', () => {
    it('renderiza com lista vazia', async () => {
      listarPorUsuarioMock.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/contexto' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Escolha o contexto')
      expect(res.body).toContain('ainda não tem acesso a nenhuma entidade')
      expect(res.body).toContain('/app/solicitar-acesso')
    })

    it('agrupa entidades por município', async () => {
      listarPorUsuarioMock.mockResolvedValue([
        ACESSO_BASE,
        {
          ...ACESSO_BASE,
          id: 'a2',
          entidadeId: 'ent2',
          entidade: {
            id: 'ent2',
            nome: 'Câmara',
            municipio: { nome: 'Curitiba', estado: { sigla: 'PR' } },
          },
        },
        {
          ...ACESSO_BASE,
          id: 'a3',
          entidadeId: 'ent3',
          entidade: {
            id: 'ent3',
            nome: 'Prefeitura de São Paulo',
            municipio: { nome: 'São Paulo', estado: { sigla: 'SP' } },
          },
        },
      ])
      const res = await app.inject({ method: 'GET', url: '/contexto' })
      expect(res.body).toContain('Curitiba')
      expect(res.body).toContain('São Paulo')
      expect(res.body).toContain('Prefeitura')
      expect(res.body).toContain('Câmara')
    })

    it('marca seleção atual quando cookie existe', async () => {
      listarPorUsuarioMock.mockResolvedValue([ACESSO_BASE])
      const res = await app.inject({
        method: 'GET',
        url: '/contexto',
        cookies: { genesis_exercicio: 'ent1:2025' },
      })
      // Apenas garante que renderiza ok com cookie válido
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('checked')
    })

    it('ignora cookie inválido sem quebrar', async () => {
      listarPorUsuarioMock.mockResolvedValue([ACESSO_BASE])
      const res = await app.inject({
        method: 'GET',
        url: '/contexto',
        cookies: { genesis_exercicio: 'lixo' },
      })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('POST /contexto', () => {
    it('rejeita sem entidadeId', async () => {
      const res = await app.inject({ method: 'POST', url: '/contexto', ...form({ ano: '2026' }) })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/contexto')
    })

    it('rejeita ano inválido', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/contexto',
        ...form({ entidadeId: 'ent1', ano: 'xx' }),
      })
      expect(res.headers.location).toBe('/app/contexto')
    })

    it('rejeita quando ano não vem no body (NaN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/contexto',
        ...form({ entidadeId: 'ent1' }),
      })
      expect(res.headers.location).toBe('/app/contexto')
    })

    it('rejeita ano fora do intervalo', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/contexto',
        ...form({ entidadeId: 'ent1', ano: '1800' }),
      })
      expect(res.headers.location).toBe('/app/contexto')
    })

    it('rejeita quando não tem acesso à entidade (defesa server-side)', async () => {
      podeAcessarMock.mockResolvedValue(false)
      const res = await app.inject({
        method: 'POST',
        url: '/contexto',
        ...form({ entidadeId: 'ent-forjada', ano: '2026' }),
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/contexto')
    })

    it('caminho feliz: seta cookie e redireciona /app', async () => {
      podeAcessarMock.mockResolvedValue(true)
      const res = await app.inject({
        method: 'POST',
        url: '/contexto',
        ...form({ entidadeId: 'ent1', ano: '2026' }),
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app')
      const setCookie = String(res.headers['set-cookie'])
      expect(setCookie).toContain('genesis_exercicio=ent1%3A2026')
    })
  })
})
