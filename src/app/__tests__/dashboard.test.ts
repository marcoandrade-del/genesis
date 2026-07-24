import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appDashboardRoutes } from '../dashboard.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'
import type { MenuAppNode } from '../../services/menu-app.js'

const ENTIDADE = {
  id: 'ent1',
  nome: 'Prefeitura',
  municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } },
}

// Área de menu usada para checar a estrela de favoritar no card do dashboard.
const AREA: MenuAppNode = {
  id: 'a1', nome: 'Orçamento', descricao: null, rota: '/app/orcamento',
  icone: 'bi-cash-coin', tipo: 'SUBMENU', filhos: [],
}

// Registra o dashboard injetando menuApp + favoritoIds via reply.locals (em produção
// isso vem do plugin pai appRoutes; aqui simulamos com um preHandler).
function registrarComCards(favoritoIds: string[]) {
  return async (api: FastifyInstance) => {
    api.addHook('preHandler', async (_req, reply) => {
      reply.locals = { menuApp: [AREA], favoritoIds }
    })
    await appDashboardRoutes(api)
  }
}

describe('appDashboardRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;({ app, prisma } = await criarApp({
      registrar: appDashboardRoutes,
      comView: true,
      simularUsuario: { sub: 'u1', email: 'u@x.com' },
      simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' },
    }))
  })

  it('renderiza dashboard com contexto ativo', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Prefeitura')
    expect(res.body).toContain('Curitiba')
    expect(res.body).toContain('2026')
    expect(res.body).toContain('Escrita')
    // atalho de trocar contexto no header + cards duplicados (Município/Exercício) removidos
    expect(res.body).toContain('Trocar o contexto')
    expect(res.body).not.toContain('Exercício corrente')
  })

  it('redireciona /app/contexto quando entidade não existe mais', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
    const setCookie = String(res.headers['set-cookie'])
    // Cookie limpo: max-age=0 / expires no passado
    expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires=/)
  })

  it('exibe badge LEITURA', async () => {
    ;({ app, prisma } = await criarApp({
      registrar: appDashboardRoutes,
      comView: true,
      simularUsuario: { sub: 'u1', email: 'u@x.com' },
      simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' },
    }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.body).toContain('Leitura')
  })

  it('exibe badge ADMIN', async () => {
    ;({ app, prisma } = await criarApp({
      registrar: appDashboardRoutes,
      comView: true,
      simularUsuario: { sub: 'u1', email: 'u@x.com' },
      simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'ADMIN' },
    }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.body).toContain('Admin')
  })

  it('exibe estrela PREENCHIDA no card quando o item está nos favoritos', async () => {
    ;({ app, prisma } = await criarApp({
      registrar: registrarComCards(['a1']),
      comView: true,
      simularUsuario: { sub: 'u1', email: 'u@x.com' },
      simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' },
    }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('data-fav-id="a1"')
    expect(res.body).toContain('gx-fav-star-card is-fav')
    expect(res.body).toContain('title="Remover dos favoritos"')
  })

  it('exibe estrela VAZIA no card quando o item não está nos favoritos', async () => {
    ;({ app, prisma } = await criarApp({
      registrar: registrarComCards([]),
      comView: true,
      simularUsuario: { sub: 'u1', email: 'u@x.com' },
      simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' },
    }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('data-fav-id="a1"')
    expect(res.body).toContain('title="Favoritar"')
  })
})
