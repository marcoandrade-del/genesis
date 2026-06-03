import { describe, it, expect, beforeEach } from 'vitest'
import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appContasRoutes } from '../contas.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Curitiba', estado: { sigla: 'PR', nome: 'Paraná' } } }

async function montar(contexto = { entidadeId: 'ent1', ano: 2026, nivel: 'LEITURA' as const }) {
  return criarApp({ registrar: appContasRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: contexto })
}

describe('appContasRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    ;({ app, prisma } = await montar())
  })

  it('lista o plano de contas do contexto (entidade + ano)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([
      { id: 'c1', codigo: '1', descricao: 'ATIVO', nivel: 1, admiteMovimento: false, origem: 'MODELO' },
      { id: 'c2', codigo: '1.1.1', descricao: 'Caixa', nivel: 3, admiteMovimento: true, origem: 'DESDOBRAMENTO' },
    ])
    const res = await app.inject({ method: 'GET', url: '/contas' })
    expect(res.statusCode).toBe(200)
    expect(prisma.contaContabilEntidade.findMany).toHaveBeenCalledWith({
      where: { entidadeId: 'ent1', ano: 2026 },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true },
    })
    expect(res.body).toContain('ATIVO')
    expect(res.body).toContain('Caixa')
    expect(res.body).toContain('Analítica')
    expect(res.body).toContain('Desdobramento')
  })

  it('estado vazio quando o plano não foi copiado para o ano', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/contas' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('não copiado para o exercício')
  })

  it('respeita o ano do contexto', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'entX', ano: 2022, nivel: 'ADMIN' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/contas' })
    expect(prisma.contaContabilEntidade.findMany.mock.calls[0][0].where).toEqual({ entidadeId: 'entX', ano: 2022 })
  })

  it('redireciona para /app/contexto se a entidade sumiu', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/contas' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contexto')
  })
})
