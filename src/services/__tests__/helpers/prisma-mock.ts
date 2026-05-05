import { vi } from 'vitest'

// Constrói um mock tipado de PrismaClient com vi.fn() para cada método usado nos testes.
// $transaction com callback (interactive transaction) chama o callback com o próprio mock.
export function criarPrismaMock() {
  const mock = {
    usuario: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    codigoValidacao: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    sistema: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    modulo: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn(),
    },
    adminSistema: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    adminModulo: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    permissaoAcesso: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn(),
    },
    itemFuncionalidade: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn(),
    },
    menu: {
      count: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    relatorioFixo: { count: vi.fn() },
    $transaction: vi.fn(),
  }

  // Suporta as duas assinaturas do $transaction:
  //   - array:    $transaction([p1, p2]) → resolve com []
  //   - callback: $transaction(async (tx) => { ... }) → chama o callback com o próprio mock
  mock.$transaction.mockImplementation((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.resolve(arg.map(() => undefined))
    return (arg as (tx: typeof mock) => Promise<unknown>)(mock)
  })

  return mock
}

export type PrismaMock = ReturnType<typeof criarPrismaMock>
