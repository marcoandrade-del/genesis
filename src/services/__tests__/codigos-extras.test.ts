import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CodigosService } from '../codigos.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { enviarCodigoEmail } from '../email.js'

vi.mock('../email.js', () => ({ enviarCodigoEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../sms.js', () => ({ enviarCodigoSms: vi.fn().mockResolvedValue(undefined) }))

const USUARIO = { id: 'u1', emailPrincipal: 'a@b.com', telefonePrincipal: '44999990000', emailValidado: false, celularValidado: false }

describe('CodigosService.solicitar — BASE_URL custom', () => {
  let prisma: PrismaMock
  let service: CodigosService
  let envOriginal: string | undefined

  beforeEach(() => {
    envOriginal = process.env['BASE_URL']
    prisma = criarPrismaMock()
    service = new CodigosService(prisma as never)
    vi.mocked(enviarCodigoEmail).mockClear()
  })

  afterEach(() => {
    if (envOriginal === undefined) delete process.env['BASE_URL']
    else process.env['BASE_URL'] = envOriginal
  })

  // Line 37 — BASE_URL definido (e com barra final removida) é usado no link
  it('usa BASE_URL do ambiente e remove barra final', async () => {
    process.env['BASE_URL'] = 'https://app.example.com/'
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })

    await service.solicitar('u1', 'EMAIL')

    expect(enviarCodigoEmail).toHaveBeenCalledWith(
      'a@b.com', expect.any(String), expect.any(Number),
      'https://app.example.com/admin/ativar/u1?passo=EMAIL',
    )
  })

  // Line 37 — BASE_URL ausente → fallback http://localhost:3000
  it('usa fallback http://localhost:3000 quando BASE_URL não está definido', async () => {
    delete process.env['BASE_URL']
    prisma.usuario.findUnique.mockResolvedValue(USUARIO)
    prisma.codigoValidacao.deleteMany.mockResolvedValue({ count: 0 })
    prisma.codigoValidacao.create.mockResolvedValue({ id: 'c1', expiradoEm: new Date(Date.now() + 900000) })

    await service.solicitar('u1', 'EMAIL')

    expect(enviarCodigoEmail).toHaveBeenCalledWith(
      'a@b.com', expect.any(String), expect.any(Number),
      'http://localhost:3000/admin/ativar/u1?passo=EMAIL',
    )
  })
})
