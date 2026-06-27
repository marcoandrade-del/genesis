import { describe, it, expect, beforeEach } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { IaPreferenciaService, IA_MOTORES } from '../ia-preferencia.js'

describe('IaPreferenciaService', () => {
  let prisma: PrismaMock
  let svc: IaPreferenciaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new IaPreferenciaService(prisma as never)
  })

  it('ler: usuário ausente → default (rápida + gemini)', async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    expect(await svc.ler('u1')).toEqual({ engine: 'rapida', motor: 'gemini' })
  })

  it('ler: valores válidos passam; inválidos normalizam pro default', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ iaEngine: 'profunda', iaMotor: 'claude' })
    expect(await svc.ler('u1')).toEqual({ engine: 'profunda', motor: 'claude' })
    prisma.usuario.findUnique.mockResolvedValue({ iaEngine: 'xx', iaMotor: 'inexistente' })
    expect(await svc.ler('u1')).toEqual({ engine: 'rapida', motor: 'gemini' })
  })

  it('salvar: valida engine e motor antes de persistir', async () => {
    prisma.usuario.update.mockResolvedValue({})
    const r = await svc.salvar('u1', { engine: 'profunda', motor: 'sabia' })
    expect(r).toEqual({ engine: 'profunda', motor: 'sabia' })
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { iaEngine: 'profunda', iaMotor: 'sabia' },
    })
    const r2 = await svc.salvar('u1', { engine: 'lixo', motor: 'lixo' })
    expect(r2).toEqual({ engine: 'rapida', motor: 'gemini' })
  })

  it('catálogo de motores marca o especialista fiscal', () => {
    expect(IA_MOTORES.find((m) => m.id === 'sabia')!.especialista).toBe(true)
    expect(IA_MOTORES.find((m) => m.id === 'gemini')!.especialista).toBe(false)
  })
})
