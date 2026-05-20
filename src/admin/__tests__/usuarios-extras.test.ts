import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('argon2', () => ({ hash: vi.fn(async (s: string) => `hashed:${s}`) }))
vi.mock('../../services/email.js', () => ({ enviarCodigoEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/sms.js', () => ({ enviarCodigoSms: vi.fn().mockResolvedValue(undefined) }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminUsuariosRoutes } from '../usuarios.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO_DB = {
  id: 'u1',
  cpf: '52998224725',
  idEstrangeiro: null,
  nomeCompleto: 'João',
  nomeSocial: '',
  dataNascimento: new Date('1990-01-15'),
  emailPrincipal: 'joao@exemplo.com',
  emailAlternativo: null,
  telefonePrincipal: '44999990000',
  telefoneAlternativo: null,
  emailValidado: false,
  celularValidado: false,
  ativo: false,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
}

describe('adminUsuariosRoutes — branches restantes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;({ app, prisma } = await criarApp({
      registrar: adminUsuariosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  describe('GET /:id/form', () => {
    it('lança ErroNegocio quando usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'GET', url: '/u-x/form' })
      expect(res.statusCode).not.toBe(200)
    })
  })

  describe('POST / — campos opcionais', () => {
    it('inclui cpf, emailAlternativo e telefoneAlternativo quando preenchidos', async () => {
      prisma.usuario.create.mockResolvedValue({ ...USUARIO_DB })
      prisma.usuario.update.mockResolvedValue({ ...USUARIO_DB, ativo: true })

      const res = await app.inject({
        method: 'POST', url: '/',
        payload: new URLSearchParams({
          nomeCompleto: 'João', nomeSocial: 'Jo', dataNascimento: '1990-01-15',
          emailPrincipal: 'joao@exemplo.com', telefonePrincipal: '44999990000',
          senha: 'senha1234', ativo: 'true',
          cpf: '52998224725',
          emailAlternativo: 'alt@exemplo.com',
          telefoneAlternativo: '44888880000',
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })

      expect(res.statusCode).toBe(204)
      const call = prisma.usuario.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
      expect(call.data['cpf']).toBe('52998224725')
      expect(call.data['emailAlternativo']).toBe('alt@exemplo.com')
      expect(call.data['telefoneAlternativo']).toBe('44888880000')
    })

    it('inclui idEstrangeiro quando preenchido (sem cpf)', async () => {
      prisma.usuario.create.mockResolvedValue({ ...USUARIO_DB, cpf: null, idEstrangeiro: 'XYZ123' })

      const res = await app.inject({
        method: 'POST', url: '/',
        payload: new URLSearchParams({
          nomeCompleto: 'Foreigner', nomeSocial: '', dataNascimento: '1990-01-15',
          emailPrincipal: 'f@x.com', telefonePrincipal: '44999990000',
          senha: 'senha1234',
          idEstrangeiro: 'XYZ123',
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })

      expect(res.statusCode).toBe(204)
      const call = prisma.usuario.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
      expect(call.data['idEstrangeiro']).toBe('XYZ123')
      expect(call.data['cpf']).toBeUndefined()
    })

    it('aplica fallback de string vazia quando campos obrigatórios ausentes', async () => {
      const res = await app.inject({
        method: 'POST', url: '/',
        payload: new URLSearchParams({}).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
      expect(res.statusCode).toBe(200)
      expect(prisma.usuario.create).not.toHaveBeenCalled()
    })
  })

  describe('PUT /:id — campos opcionais ausentes', () => {
    it('atualiza apenas com ativo quando nenhum outro campo é enviado', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
      prisma.usuario.update.mockResolvedValue({ ...USUARIO_DB, ativo: true })

      const res = await app.inject({
        method: 'PUT', url: '/u1',
        payload: new URLSearchParams({ ativo: 'true' }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })

      expect(res.statusCode).toBe(204)
      const call = prisma.usuario.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }
      expect(call.data).toEqual({ ativo: true })
    })

    it('inclui todos os campos opcionais quando preenchidos', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
      prisma.usuario.update.mockResolvedValue({ ...USUARIO_DB })

      const res = await app.inject({
        method: 'PUT', url: '/u1',
        payload: new URLSearchParams({
          nomeCompleto: 'Novo',
          nomeSocial: 'Apelido',
          dataNascimento: '1990-05-10',
          telefonePrincipal: '44999990001',
          emailAlternativo: 'alt@x.com',
          telefoneAlternativo: '44888880001',
          senha: 'novaSenha123',
          ativo: 'false',
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })

      expect(res.statusCode).toBe(204)
      const call = prisma.usuario.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }
      expect(call.data['nomeCompleto']).toBe('Novo')
      expect(call.data['nomeSocial']).toBe('Apelido')
      expect(call.data['telefonePrincipal']).toBe('44999990001')
      expect(call.data['emailAlternativo']).toBe('alt@x.com')
      expect(call.data['telefoneAlternativo']).toBe('44888880001')
      expect(call.data['senhaHash']).toBe('hashed:novaSenha123')
    })

    it('renderiza form com erro quando service falha', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
      prisma.usuario.update.mockRejectedValue(new Error('Falha ao atualizar.'))

      const res = await app.inject({
        method: 'PUT', url: '/u1',
        payload: new URLSearchParams({ nomeCompleto: 'Novo', ativo: 'true' }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
      expect(res.body).toContain('Falha ao atualizar.')
    })
  })

  describe('POST /:id/enviar-codigo-email — erro genérico', () => {
    it('retorna 500 quando erro não é ErroNegocio', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
      prisma.codigoValidacao.deleteMany.mockRejectedValue(new Error('boom'))

      const res = await app.inject({ method: 'POST', url: '/u1/enviar-codigo-email' })
      expect(res.statusCode).toBe(500)
      expect(res.body).toContain('e-mail')
    })
  })

  describe('POST /:id/enviar-codigo-celular — branches do catch', () => {
    it('retorna 404 (ErroNegocio) quando usuário não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null)
      const res = await app.inject({ method: 'POST', url: '/u-x/enviar-codigo-celular' })
      expect(res.statusCode).toBe(404)
    })

    it('retorna 409 (ErroNegocio) quando celular já validado', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB, celularValidado: true })
      const res = await app.inject({ method: 'POST', url: '/u1/enviar-codigo-celular' })
      expect(res.statusCode).toBe(409)
    })

    it('retorna 500 quando erro não é ErroNegocio', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
      prisma.codigoValidacao.deleteMany.mockRejectedValue(new Error('boom'))

      const res = await app.inject({ method: 'POST', url: '/u1/enviar-codigo-celular' })
      expect(res.statusCode).toBe(500)
      expect(res.body).toContain('SMS')
    })
  })

  describe('DELETE /:id — erro genérico', () => {
    it('retorna 500 quando erro não é ErroNegocio', async () => {
      prisma.usuario.findUnique.mockRejectedValue(new Error('db down'))
      const res = await app.inject({ method: 'DELETE', url: '/u1' })
      expect(res.statusCode).toBe(500)
      expect(res.body).toContain('excluir')
    })
  })
})
