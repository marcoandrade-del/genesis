import { describe, it, expect, beforeEach } from 'vitest'
import { assertAdminMenu } from '../autorizacao.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

describe('assertAdminMenu', () => {
  let prisma: PrismaMock

  beforeEach(() => {
    prisma = criarPrismaMock()
  })

  // Line 68 — menu inexistente lança RECURSO_NAO_ENCONTRADO
  it('lança RECURSO_NAO_ENCONTRADO quando menu não existe', async () => {
    prisma.menu.findUnique.mockResolvedValue(null)
    await expect(assertAdminMenu(prisma as never, 'u1', 'me-x'))
      .rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
  })
})
