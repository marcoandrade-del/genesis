import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
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
      select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true, parentId: true },
    })
    expect(res.body).toContain('ATIVO')
    expect(res.body).toContain('Caixa')
    expect(res.body).toContain('Analítica')
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

  it('exibe saldos por conta (inicial/débito/crédito/saldo atual por natureza)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([
      { id: 'c1', codigo: '1.1.1', descricao: 'Caixa', nivel: 3, admiteMovimento: true, origem: 'MODELO', parentId: null, modeloContaId: 'm1' },
    ])
    prisma.conta.findMany.mockResolvedValue([{ id: 'm1', naturezaSaldo: 'DEVEDORA' }])
    prisma.saldoInicialAno.findMany.mockResolvedValue([{ contaId: 'c1', valor: new Prisma.Decimal(100) }])
    prisma.lancamentoItem.groupBy.mockResolvedValue([
      { contaId: 'c1', tipo: 'DEBITO', _sum: { valor: new Prisma.Decimal(50) } },
      { contaId: 'c1', tipo: 'CREDITO', _sum: { valor: new Prisma.Decimal(20) } },
    ])
    const res = await app.inject({ method: 'GET', url: '/contas' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Saldo atual')
    expect(res.body).toContain('Devedora')
    // DEVEDORA: 100 + (50 − 20) = 130
    expect(res.body).toMatch(/130,00/)
  })

  it('GET ?desdobrar abre o form de uma conta analítica do escopo', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([
      { id: 'c1', codigo: '1.1.1.1.1.01.00.00.00.00.00.00', descricao: 'Caixa', nivel: 6, admiteMovimento: true, origem: 'MODELO', parentId: null },
    ])
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1', entidadeId: 'ent1', admiteMovimento: true, codigo: '1.1.1.1.1.01.00.00.00.00.00.00' })
    const res = await app.inject({ method: 'GET', url: '/contas?desdobrar=c1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Desdobrar conta')
    expect(res.body).toContain('1.1.1.1.1.01.01.00.00.00.00.00') // preenche o 1º segmento zerado
  })

  it('POST desdobrar com nível LEITURA → 403', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'POST', url: '/contas/c1/desdobrar', payload: { codigo: '1.1.1.01', descricao: 'X' } })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('apenas leitura')
  })

  it('POST desdobrar conta de outra entidade → 404 (fora do escopo)', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'cX', entidadeId: 'OUTRA', admiteMovimento: true })
    const res = await app.inject({ method: 'POST', url: '/contas/cX/desdobrar', payload: { codigo: '9', descricao: 'X' } })
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('não encontrada nesta entidade')
  })

  it('POST desdobrar feliz → 302 para /app/contas', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1', entidadeId: 'ent1', ano: 2026, nivel: 3, admiteMovimento: true, codigo: '1.1.1' })
    prisma.contaContabilEntidade.create.mockResolvedValue({ id: 'filho' })
    prisma.contaContabilEntidade.update.mockResolvedValue({})
    const res = await app.inject({ method: 'POST', url: '/contas/c1/desdobrar', payload: { codigo: '1.1.1.01', descricao: 'Caixa Geral' } })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contas')
  })

  it('POST excluir com nível LEITURA → 403', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'POST', url: '/contas/c1/excluir' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('apenas leitura')
  })
})
