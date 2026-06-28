import { describe, it, expect } from 'vitest'
import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appContasReceitaRoutes } from '../contas-receita.js'
import { appContasDespesaRoutes } from '../contas-despesa.js'

const ENTIDADE = { id: 'ent1', nome: 'Prefeitura', municipio: { nome: 'Maringá', estado: { sigla: 'PR', nome: 'Paraná' } } }
const CTX = { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' as const }

describe('planos de receita e despesa no /app (factory compartilhada)', () => {
  it('receita: lista do contexto com saldo (previsto × arrecadado) + seletor de data', async () => {
    const { app, prisma } = await criarApp({ registrar: appContasReceitaRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: CTX })
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([
      { id: 'r1', codigo: '1', descricao: 'RECEITAS CORRENTES', nivel: 1, admiteMovimento: false, origem: 'MODELO', parentId: null },
    ])
    const res = await app.inject({ method: 'GET', url: '/contas-receita' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Plano de Receita')
    expect(res.body).toContain('RECEITAS CORRENTES')
    expect(res.body).not.toContain('Saldo atual') // não é o saldo contábil (natureza)
    expect(res.body).toContain('Previsto') // colunas de saldo da receita
    expect(res.body).toContain('A arrecadar')
    expect(res.body).toContain('Posição em') // seletor de data
    expect(res.body).toContain('Bimestral') // seletor de desdobramento por período
    expect(res.body).toContain('Quadrimestral')
    expect(prisma.contaReceitaEntidade.findMany).toHaveBeenCalledWith({
      where: { entidadeId: 'ent1', ano: 2026 },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true, parentId: true },
    })
  })

  it('receita: ▸ desdobramento mensal por conta quando há arrecadação', async () => {
    const { app, prisma } = await criarApp({ registrar: appContasReceitaRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: CTX })
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaReceitaEntidade.findMany.mockResolvedValue([
      { id: 'r1', codigo: '1', descricao: 'RECEITAS CORRENTES', nivel: 1, admiteMovimento: false, origem: 'MODELO', parentId: null },
    ])
    prisma.arrecadacao.findMany.mockResolvedValue([
      { contaReceitaEntidadeId: 'r1', data: new Date(Date.UTC(2026, 0, 10)), valor: 123 },
    ])
    const res = await app.inject({ method: 'GET', url: '/contas-receita' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('data-mensal=') // os 12 valores embutidos na linha
    expect(res.body).toContain('mensal-toggle') // o botão ▸
  })

  it('despesa: lista do contexto e consulta o model de despesa', async () => {
    const { app, prisma } = await criarApp({ registrar: appContasDespesaRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: CTX })
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaDespesaEntidade.findMany.mockResolvedValue([
      { id: 'd1', codigo: '3', descricao: 'DESPESAS CORRENTES', nivel: 1, admiteMovimento: false, origem: 'MODELO', parentId: null },
    ])
    const res = await app.inject({ method: 'GET', url: '/contas-despesa' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Plano de Despesa')
    expect(res.body).toContain('DESPESAS CORRENTES')
    expect(res.body).toContain('Autorizado') // colunas de saldo da despesa
    expect(res.body).toContain('Disponível')
    expect(res.body).toContain('Posição em') // seletor de data
    expect(res.body).toContain('Bimestral') // seletor de desdobramento por período
    expect(prisma.contaDespesaEntidade.findMany).toHaveBeenCalledWith({
      where: { entidadeId: 'ent1', ano: 2026 },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, descricao: true, nivel: true, admiteMovimento: true, origem: true, parentId: true },
    })
  })

  it('despesa: desdobrar exige ESCRITA (LEITURA → 403)', async () => {
    const { app, prisma } = await criarApp({ registrar: appContasDespesaRoutes, comView: true, simularUsuario: { sub: 'u1', email: 'u@x.com' }, simularContexto: { ...CTX, nivel: 'LEITURA' } })
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.contaDespesaEntidade.findMany.mockResolvedValue([])
    const res = await app.inject({ method: 'POST', url: '/contas-despesa/x/desdobrar', payload: { codigo: '3.1', descricao: 'X' } })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('apenas leitura')
  })
})
