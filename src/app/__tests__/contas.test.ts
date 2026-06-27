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
    // controle de colapsar/expandir por nível
    expect(res.body).toContain('id="nivel-menos"')
    expect(res.body).toContain('id="nivel-mais"')
    expect(res.body).toContain('data-nivel="3"')
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

  it('razão: renderiza movimentos e saldo corrente por intervalo de datas', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1', codigo: '1.1.1', descricao: 'Caixa', entidadeId: 'ent1', modeloContaId: 'm1' })
    prisma.conta.findUnique.mockResolvedValue({ naturezaSaldo: 'DEVEDORA' })
    prisma.saldoInicialAno.findUnique.mockResolvedValue({ valor: new Prisma.Decimal(500) })
    prisma.lancamentoItem.groupBy.mockResolvedValue([]) // nada antes do início
    prisma.resumoMensalConta.findMany.mockResolvedValue([{ mes: 3, totalDebito: new Prisma.Decimal(1000), totalCredito: new Prisma.Decimal(0) }])
    prisma.lancamentoItem.findMany.mockResolvedValue([
      { tipo: 'DEBITO', valor: new Prisma.Decimal(1000), lancamento: { data: new Date(Date.UTC(2026, 2, 15)), historico: 'Recebimento' } },
    ])
    const res = await app.inject({ method: 'GET', url: '/contas/c1/razao?de=2026-03-01&ate=2026-03-31' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Caixa')
    expect(res.body).toContain('Recebimento')
    expect(res.body).toContain('01/03/2026 a 31/03/2026') // rótulo do período
    // saldo anterior 500 + débito 1000 = 1.500 (DEVEDORA)
    expect(res.body).toMatch(/1\.500,00/)
    // razaoDoPeriodo: itens buscados com gte/lte do intervalo
    const argsItens = prisma.lancamentoItem.findMany.mock.calls.at(-1)![0]
    expect(argsItens.where.lancamento.data).toEqual({ gte: expect.any(Date), lte: expect.any(Date) })
  })

  it('razão: sem filtro abrange o exercício inteiro', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1', codigo: '1.1.1', descricao: 'Caixa', entidadeId: 'ent1', modeloContaId: null })
    prisma.saldoInicialAno.findUnique.mockResolvedValue(null)
    prisma.lancamentoItem.groupBy.mockResolvedValue([])
    prisma.resumoMensalConta.findMany.mockResolvedValue([])
    prisma.lancamentoItem.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/contas/c1/razao' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('exercício 2026')
  })

  it('razão: conta de outra entidade → redireciona para /app/contas', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'cX', codigo: '9', descricao: 'X', entidadeId: 'OUTRA', modeloContaId: null })
    const res = await app.inject({ method: 'GET', url: '/contas/cX/razao' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contas')
  })

  it('POST editar com nível LEITURA → 403', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'POST', url: '/contas/d1/editar', payload: { descricao: 'X' } })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('apenas leitura')
  })

  it('POST editar descrição de um desdobramento → 302', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([])
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'd1', entidadeId: 'ent1', admiteMovimento: true, origem: 'DESDOBRAMENTO', descricao: 'Antiga' })
    prisma.contaContabilEntidade.update.mockResolvedValue({})
    const res = await app.inject({ method: 'POST', url: '/contas/d1/editar', payload: { descricao: 'Nova' } })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contas')
  })

  it('marca conta redutora "(-)" e mostra atributo PCASP (natureza da informação)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findMany.mockResolvedValue([
      { id: 'c1', codigo: '1.2.3.8', descricao: '(-) Depreciação Acumulada', nivel: 4, admiteMovimento: true, origem: 'MODELO', parentId: null, modeloContaId: 'm1' },
    ])
    prisma.conta.findMany.mockResolvedValue([
      { id: 'm1', naturezaSaldo: 'CREDORA', naturezaInformacao: 'PATRIMONIAL', superavitFinanceiro: 'PATRIMONIAL', funcao: 'Registra a depreciação.' },
    ])
    const res = await app.inject({ method: 'GET', url: '/contas' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('redutora')
    expect(res.body).toContain('Patrim.') // naturezaInformacao abreviada
  })

  it('distribuir: GET de uma conta analítica do escopo renderiza o fluxo', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1', codigo: '1.1.1', descricao: 'Caixa', entidadeId: 'ent1', admiteMovimento: true })
    prisma.saldoInicialAno.findUnique.mockResolvedValue({ valor: new Prisma.Decimal(500) })
    prisma.lancamentoItem.findMany.mockResolvedValue([
      { id: 'it1', tipo: 'DEBITO', valor: new Prisma.Decimal(1000), lancamento: { data: new Date(Date.UTC(2026, 2, 10)), historico: 'Receb.' } },
    ])
    const res = await app.inject({ method: 'GET', url: '/contas/c1/distribuir' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Desdobrar com distribuição')
    expect(res.body).toContain('Caixa')
    expect(res.body).toContain('Receb.')
  })

  it('distribuir: conta de outra entidade → redireciona', async () => {
    ;({ app, prisma } = await montar({ entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' }))
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'cX', codigo: '9', descricao: 'X', entidadeId: 'OUTRA', admiteMovimento: true })
    const res = await app.inject({ method: 'GET', url: '/contas/cX/distribuir' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contas')
  })

  it('distribuir: LEITURA não acessa o GET (redireciona)', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE) // contexto padrão é LEITURA
    const res = await app.inject({ method: 'GET', url: '/contas/c1/distribuir' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/app/contas')
  })

  it('distribuir: POST com LEITURA → 403', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaContabilEntidade.findUnique.mockResolvedValue({ id: 'c1', codigo: '1.1.1', descricao: 'Caixa', entidadeId: 'ent1', admiteMovimento: true })
    prisma.saldoInicialAno.findUnique.mockResolvedValue(null)
    prisma.lancamentoItem.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'POST', url: '/contas/c1/distribuir', payload: { filhos: '[]', distribuicao: '{}' } })
    expect(res.statusCode).toBe(403)
  })
})
