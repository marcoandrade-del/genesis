import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('argon2', () => ({ hash: vi.fn(async (s: string) => `hashed:${s}`) }))
vi.mock('../../services/email.js', () => ({ enviarCodigoEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../services/sms.js', () => ({ enviarCodigoSms: vi.fn().mockResolvedValue(undefined) }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { adminUsuariosRoutes } from '../usuarios.js'
import { enviarCodigoEmail } from '../../services/email.js'
import { enviarCodigoSms } from '../../services/sms.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const USUARIO_DB = {
  id: 'u1',
  cpf: '52998224725',
  idEstrangeiro: null,
  nomeCompleto: 'João Silva',
  nomeSocial: 'João',
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

describe('adminUsuariosRoutes — fluxo de validação (apenas envio, sem marcação manual)', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({
      registrar: adminUsuariosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  it('POST /:id/enviar-codigo-email dispara envio e retorna 204 com HX-Trigger mostrarInfo', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })

    const res = await app.inject({ method: 'POST', url: '/u1/enviar-codigo-email' })

    expect(res.statusCode).toBe(204)
    const trigger = JSON.parse(res.headers['hx-trigger'] as string)
    expect(trigger).toHaveProperty('mostrarInfo')
    expect(trigger.mostrarInfo.titulo).toMatch(/e-?mail/i)
    expect(enviarCodigoEmail).toHaveBeenCalledWith(
      'joao@exemplo.com',
      expect.stringMatching(/^\d{6}$/),
      expect.any(Number),
      expect.stringContaining('/admin/ativar/u1?passo=EMAIL'),
    )
    // Crítico: nunca marca emailValidado direto (só CodigosService.validar faz isso)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it('POST /:id/enviar-codigo-celular dispara envio de SMS e retorna 204 com HX-Trigger', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c2', expiradoEm: new Date(Date.now() + 900000) })

    const res = await app.inject({ method: 'POST', url: '/u1/enviar-codigo-celular' })

    expect(res.statusCode).toBe(204)
    expect(JSON.parse(res.headers['hx-trigger'] as string).mostrarInfo).toBeDefined()
    expect(enviarCodigoSms).toHaveBeenCalledWith(
      '44999990000',
      expect.stringMatching(/^\d{6}$/),
      expect.any(Number),
    )
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it('POST /:id/enviar-codigo-email retorna 404 quando usuário não existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'POST', url: '/u999/enviar-codigo-email' })
    expect(res.statusCode).toBe(404)
  })

  it('POST /:id/enviar-codigo-email retorna 409 quando e-mail já validado', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB, emailValidado: true })
    const res = await app.inject({ method: 'POST', url: '/u1/enviar-codigo-email' })
    expect(res.statusCode).toBe(409)
    expect(prisma.codigoValidacao.create).not.toHaveBeenCalled()
  })

  it('rota antiga POST /:id/validar-email não existe mais (404)', async () => {
    const res = await app.inject({ method: 'POST', url: '/u1/validar-email' })
    expect(res.statusCode).toBe(404)
  })

  it('rota antiga POST /:id/validar-celular não existe mais (404)', async () => {
    const res = await app.inject({ method: 'POST', url: '/u1/validar-celular' })
    expect(res.statusCode).toBe(404)
  })
})

describe('adminUsuariosRoutes — CRUD', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ({ app, prisma } = await criarApp({
      registrar: adminUsuariosRoutes,
      comView: true,
      simularAdmin: { sub: 'admin1', email: 'admin@x.com' },
    }))
  })

  it('POST / cria usuário com sucesso e retorna 204 + HX-Trigger usuarioSalvo', async () => {
    prisma.usuario.create.mockResolvedValue({ ...USUARIO_DB })

    const res = await app.inject({
      method: 'POST', url: '/',
      payload: new URLSearchParams({
        nomeCompleto: 'João Silva',
        nomeSocial: 'João',
        dataNascimento: '1990-01-15',
        emailPrincipal: 'joao@exemplo.com',
        telefonePrincipal: '44999990000',
        senha: 'senha1234',
        cpf: '52998224725',
        ativo: 'false',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['hx-trigger']).toContain('usuarioSalvo')
  })

  it('PUT /:id retorna 204 ao atualizar com sucesso', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
    prisma.usuario.update.mockResolvedValue({ ...USUARIO_DB, nomeCompleto: 'Novo Nome' })

    const res = await app.inject({
      method: 'PUT', url: '/u1',
      payload: new URLSearchParams({ nomeCompleto: 'Novo Nome', ativo: 'true' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['hx-trigger']).toContain('usuarioSalvo')
  })

  it('DELETE /:id retorna 200 ao excluir com sucesso', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
    prisma.adminSistema.count.mockResolvedValue(0)
    prisma.adminModulo.count.mockResolvedValue(0)
    prisma.permissaoAcesso.count.mockResolvedValue(0)
    prisma.relatorioPersonalizado.count.mockResolvedValue(0)
    prisma.pastaFavorito.count.mockResolvedValue(0)
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    prisma.usuario.delete.mockResolvedValue(USUARIO_DB)
    const res = await app.inject({ method: 'DELETE', url: '/u1' })
    expect(res.statusCode).toBe(200)
  })

  it('DELETE /:id retorna 409 quando usuário é admin de sistema', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ...USUARIO_DB })
    prisma.adminSistema.count.mockResolvedValue(1)
    prisma.adminModulo.count.mockResolvedValue(0)
    prisma.permissaoAcesso.count.mockResolvedValue(0)
    prisma.relatorioPersonalizado.count.mockResolvedValue(0)
    prisma.pastaFavorito.count.mockResolvedValue(0)
    prisma.favoritoRelatorio.count.mockResolvedValue(0)
    const res = await app.inject({ method: 'DELETE', url: '/u1' })
    expect(res.statusCode).toBe(409)
  })
})
