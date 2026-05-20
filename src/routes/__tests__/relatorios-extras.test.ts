import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { relatoriosRoutes } from '../relatorios.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = { id: 'u1', nomeCompleto: 'A', ativo: true }
const PERSONALIZADO = { id: 'rp1', usuarioId: 'u1', nome: 'P', descricao: null, configuracao: {}, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

describe('relatoriosRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ;({ app, prisma } = await criarApp({ registrar: relatoriosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  it('DELETE /relatorios/:id retorna 404 quando relatório fixo não existe', async () => {
    prisma.relatorioFixo.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/relatorios/rf-x', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /usuarios/:usuarioId/relatorios-personalizados retorna lista para o próprio usuário', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioPersonalizado.findMany.mockResolvedValue([PERSONALIZADO])
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/relatorios-personalizados', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('PUT /relatorios-personalizados/:id retorna 404 quando não existe', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/relatorios-personalizados/rp-x', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /relatorios-personalizados/:id atualiza com sucesso quando dono == self', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(PERSONALIZADO)
    prisma.relatorioPersonalizado.update.mockResolvedValue({ ...PERSONALIZADO, nome: 'Novo' })
    const res = await app.inject({
      method: 'PUT', url: '/relatorios-personalizados/rp1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.nome).toBe('Novo')
  })

  it('PUT /relatorios-personalizados/:id propaga erro do service via tratarErro', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(PERSONALIZADO)
    prisma.relatorioPersonalizado.update.mockRejectedValue(new Error('boom'))
    const res = await app.inject({
      method: 'PUT', url: '/relatorios-personalizados/rp1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(500)
  })

  it('DELETE /relatorios-personalizados/:id retorna 404 quando não existe', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/relatorios-personalizados/rp-x', headers: auth })
    expect(res.statusCode).toBe(404)
  })
})
