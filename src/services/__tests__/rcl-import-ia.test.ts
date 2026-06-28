import { describe, it, expect, beforeEach, vi } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { RclImportIaService } from '../rcl-import-ia.js'
import { ErroNegocio } from '../../errors.js'
import type { MotorIaClient } from '../ia-cliente.js'

describe('RclImportIaService.proporComposicao', () => {
  let prisma: PrismaMock
  let ia: { chamar: ReturnType<typeof vi.fn> }
  let svc: RclImportIaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    prisma.usuario.findUnique.mockResolvedValue({ iaEngine: 'profunda', iaMotor: 'claude' })
    ia = { chamar: vi.fn() }
    svc = new RclImportIaService(prisma as never, ia as unknown as MotorIaClient)
  })

  it('propõe composição válida (tolera cercas ```json) e usa o motor do usuário', async () => {
    ia.chamar.mockResolvedValue({
      texto: '```json\n{"nome":"TCE-PR","deducoes":[{"rotulo":"FUNDEB","prefixos":["1.7.5.1.50"]}]}\n```',
    })
    const c = await svc.proporComposicao('u1', 'planilha de texto')
    expect(c.nome).toBe('TCE-PR')
    expect(c.deducoes[0]!.prefixos).toEqual(['1.7.5.1.50'])
    expect(ia.chamar).toHaveBeenCalledWith(expect.objectContaining({ motorId: 'claude' }))
  })

  it('JSON inválido nas 2 tentativas → IA_FALHOU (com retry)', async () => {
    ia.chamar.mockResolvedValue({ texto: 'isto não é json' })
    await expect(svc.proporComposicao('u1', 'x')).rejects.toMatchObject({ code: 'IA_FALHOU' })
    expect(ia.chamar).toHaveBeenCalledTimes(2)
  })

  it('JSON sem deduções válidas → IA_FALHOU', async () => {
    ia.chamar.mockResolvedValue({ texto: '{"nome":"X","deducoes":[]}' })
    await expect(svc.proporComposicao('u1', 'x')).rejects.toMatchObject({ code: 'IA_FALHOU' })
  })

  it('planilha vazia → REQUISICAO_INVALIDA (não chama a IA)', async () => {
    await expect(svc.proporComposicao('u1', '   ')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(ia.chamar).not.toHaveBeenCalled()
  })

  it('erro do motor (ex.: sem chave) propaga sem retry', async () => {
    ia.chamar.mockRejectedValue(new ErroNegocio('IA_NAO_CONFIGURADA', 'sem chave'))
    await expect(svc.proporComposicao('u1', 'x')).rejects.toMatchObject({ code: 'IA_NAO_CONFIGURADA' })
    expect(ia.chamar).toHaveBeenCalledTimes(1)
  })
})
