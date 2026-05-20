import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { relatoriosRoutes } from '../relatorios.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const SISTEMA = { id: 's1', nome: 'S', descricao: null, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const USUARIO = { id: 'u1', nomeCompleto: 'A', ativo: true }
const FIXO = { id: 'rf1', sistemaId: 's1', nome: 'R', descricao: null, rota: '/r', ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }
const PERSONALIZADO = { id: 'rp1', usuarioId: 'u1', nome: 'P', descricao: null, configuracao: {}, ativo: true, criadoEm: new Date(), atualizadoEm: new Date() }

describe('relatoriosRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: relatoriosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
    prisma.adminSistema.findUnique.mockResolvedValue({ id: 'as0', ativo: true })
  })

  it('GET /sistemas/:sistemaId/relatorios exige auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1/relatorios' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /sistemas/:sistemaId/relatorios retorna 404 quando sistema não existe', async () => {
    prisma.sistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1/relatorios', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('GET /sistemas/:sistemaId/relatorios retorna lista', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.relatorioFixo.findMany.mockResolvedValue([FIXO])
    const res = await app.inject({ method: 'GET', url: '/sistemas/s1/relatorios', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('POST /sistemas/:sistemaId/relatorios retorna 201', async () => {
    prisma.sistema.findUnique.mockResolvedValue(SISTEMA)
    prisma.relatorioFixo.create.mockResolvedValue(FIXO)
    const res = await app.inject({
      method: 'POST', url: '/sistemas/s1/relatorios', headers: auth,
      payload: { nome: 'R', rota: '/r' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /sistemas/:sistemaId/relatorios retorna 409 quando sistema inativo', async () => {
    prisma.sistema.findUnique.mockResolvedValue({ ...SISTEMA, ativo: false })
    const res = await app.inject({
      method: 'POST', url: '/sistemas/s1/relatorios', headers: auth,
      payload: { nome: 'R', rota: '/r' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('PUT /relatorios/:id retorna 404 quando não existe', async () => {
    prisma.relatorioFixo.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/relatorios/rf1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /relatorios/:id atualiza com sucesso', async () => {
    prisma.relatorioFixo.findUnique.mockResolvedValue(FIXO)
    prisma.relatorioFixo.update.mockResolvedValue({ ...FIXO, nome: 'Novo' })
    const res = await app.inject({
      method: 'PUT', url: '/relatorios/rf1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /relatorios/:id retorna 409 quando há favoritos vinculados', async () => {
    prisma.relatorioFixo.findUnique.mockResolvedValue(FIXO)
    prisma.favoritoRelatorio.count.mockResolvedValue(1)
    const res = await app.inject({ method: 'DELETE', url: '/relatorios/rf1', headers: auth })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE /relatorios/:id retorna 204 quando sem vínculos', async () => {
    prisma.relatorioFixo.findUnique.mockResolvedValue(FIXO)
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    prisma.relatorioFixo.delete.mockResolvedValue(FIXO)
    const res = await app.inject({ method: 'DELETE', url: '/relatorios/rf1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('GET /usuarios/:usuarioId/relatorios-personalizados retorna 404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/relatorios-personalizados', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /usuarios/:usuarioId/relatorios-personalizados retorna 201', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.relatorioPersonalizado.create.mockResolvedValue(PERSONALIZADO)
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/relatorios-personalizados', headers: auth,
      payload: { nome: 'P', configuracao: {} },
    })
    expect(res.statusCode).toBe(201)
  })

  it('POST /usuarios/:usuarioId/relatorios-personalizados retorna 409 quando usuário inativo', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO, ativo: false })
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/relatorios-personalizados', headers: auth,
      payload: { nome: 'P', configuracao: {} },
    })
    expect(res.statusCode).toBe(409)
  })

  it('POST /usuarios/:usuarioId/relatorios-personalizados retorna 400 sem configuracao (schema)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/usuarios/u1/relatorios-personalizados', headers: auth,
      payload: { nome: 'P' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE /relatorios-personalizados/:id retorna 409 quando há favoritos vinculados', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(PERSONALIZADO)
    prisma.favoritoRelatorio.count.mockResolvedValue(1)
    const res = await app.inject({ method: 'DELETE', url: '/relatorios-personalizados/rp1', headers: auth })
    expect(res.statusCode).toBe(409)
  })

  it('DELETE /relatorios-personalizados/:id retorna 204 quando sem vínculos', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue(PERSONALIZADO)
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    prisma.relatorioPersonalizado.delete.mockResolvedValue(PERSONALIZADO)
    const res = await app.inject({ method: 'DELETE', url: '/relatorios-personalizados/rp1', headers: auth })
    expect(res.statusCode).toBe(204)
  })

  it('POST /sistemas/:sistemaId/relatorios retorna 403 quando não-admin', async () => {
    prisma.adminSistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'POST', url: '/sistemas/s1/relatorios', headers: auth,
      payload: { nome: 'R', rota: '/r' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('PUT /relatorios/:id retorna 403 quando não-admin', async () => {
    prisma.relatorioFixo.findUnique.mockResolvedValue(FIXO)
    prisma.adminSistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({
      method: 'PUT', url: '/relatorios/rf1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('DELETE /relatorios/:id retorna 403 quando não-admin', async () => {
    prisma.relatorioFixo.findUnique.mockResolvedValue(FIXO)
    prisma.adminSistema.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/relatorios/rf1', headers: auth })
    expect(res.statusCode).toBe(403)
  })

  it('GET /usuarios/:usuarioId/relatorios-personalizados retorna 403 quando usuarioId ≠ self', async () => {
    const res = await app.inject({ method: 'GET', url: '/usuarios/outro/relatorios-personalizados', headers: auth })
    expect(res.statusCode).toBe(403)
  })

  it('POST /usuarios/:usuarioId/relatorios-personalizados retorna 403 quando usuarioId ≠ self', async () => {
    const res = await app.inject({
      method: 'POST', url: '/usuarios/outro/relatorios-personalizados', headers: auth,
      payload: { nome: 'P', configuracao: {} },
    })
    expect(res.statusCode).toBe(403)
  })

  it('PUT /relatorios-personalizados/:id retorna 403 quando dono ≠ self', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ ...PERSONALIZADO, usuarioId: 'outro' })
    const res = await app.inject({
      method: 'PUT', url: '/relatorios-personalizados/rp1', headers: auth,
      payload: { nome: 'Novo' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('DELETE /relatorios-personalizados/:id retorna 403 quando dono ≠ self', async () => {
    prisma.relatorioPersonalizado.findUnique.mockResolvedValue({ ...PERSONALIZADO, usuarioId: 'outro' })
    const res = await app.inject({ method: 'DELETE', url: '/relatorios-personalizados/rp1', headers: auth })
    expect(res.statusCode).toBe(403)
  })
})
