import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp, tokenJwt } from './helpers/criarApp.js'
import { favoritosRoutes } from '../favoritos.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO = { id: 'u1', nomeCompleto: 'A', ativo: true }
const PASTA = { id: 'pa1', usuarioId: 'u1', parentId: null, nome: 'Pasta', ordem: 0, criadoEm: new Date(), atualizadoEm: new Date() }
const FAVORITO = {
  id: 'fa1', usuarioId: 'u1', pastaId: null, relatorioFixoId: 'rf1',
  relatorioPersonalizadoId: null, ordem: 0, criadoEm: new Date(),
}

describe('favoritosRoutes — caminhos restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  let auth: { authorization: string }

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({ registrar: favoritosRoutes, proteger: true }))
    auth = { authorization: `Bearer ${tokenJwt(app, { sub: 'u1', email: 'a@b.com' })}` }
  })

  // Line 19 — GET /usuarios/:usuarioId/pastas success
  it('GET /usuarios/:usuarioId/pastas retorna lista', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.pastaFavorito.findMany.mockResolvedValue([PASTA])
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/pastas', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  // Line 55 — PUT /pastas/:id catch
  it('PUT /pastas/:id retorna erro tratado quando service falha', async () => {
    prisma.pastaFavorito.findUnique.mockResolvedValue(PASTA)
    prisma.pastaFavorito.update.mockRejectedValue(new Error('boom'))
    const res = await app.inject({
      method: 'PUT', url: '/pastas/pa1', headers: auth,
      payload: { nome: 'Nova' },
    })
    expect(res.statusCode).toBe(500)
  })

  // Line 62 — DELETE /pastas/:id 404 quando pasta não existe
  it('DELETE /pastas/:id retorna 404 quando pasta não existe', async () => {
    prisma.pastaFavorito.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/pastas/pa1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  // Line 86 — GET /usuarios/:usuarioId/favoritos catch
  it('GET /usuarios/:usuarioId/favoritos retorna erro tratado quando service falha', async () => {
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.favoritoRelatorio.findMany.mockRejectedValue(new Error('boom'))
    const res = await app.inject({ method: 'GET', url: '/usuarios/u1/favoritos', headers: auth })
    expect(res.statusCode).toBe(500)
  })

  // Line 123 — PUT /favoritos/:id catch
  it('PUT /favoritos/:id retorna erro tratado quando service falha', async () => {
    prisma.favoritoRelatorio.findUnique.mockResolvedValue(FAVORITO)
    prisma.favoritoRelatorio.update.mockRejectedValue(new Error('boom'))
    const res = await app.inject({
      method: 'PUT', url: '/favoritos/fa1', headers: auth,
      payload: { ordem: 1 },
    })
    expect(res.statusCode).toBe(500)
  })

  // Line 130 — DELETE /favoritos/:id 404 quando não existe
  it('DELETE /favoritos/:id retorna 404 quando favorito não existe', async () => {
    prisma.favoritoRelatorio.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'DELETE', url: '/favoritos/fa1', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  // Line 138 — DELETE /favoritos/:id catch
  it('DELETE /favoritos/:id retorna erro tratado quando service falha', async () => {
    prisma.favoritoRelatorio.findUnique.mockResolvedValue(FAVORITO)
    prisma.favoritoRelatorio.delete.mockRejectedValue(new Error('boom'))
    const res = await app.inject({ method: 'DELETE', url: '/favoritos/fa1', headers: auth })
    expect(res.statusCode).toBe(500)
  })
})
