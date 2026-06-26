import { describe, it, expect, beforeEach, vi } from 'vitest'

const { resumoMock, calcularMock, gerarPdfMock } = vi.hoisted(() => ({
  resumoMock: vi.fn(),
  calcularMock: vi.fn(),
  gerarPdfMock: vi.fn(),
}))

vi.mock('../../services/arrecadacoes.js', () => ({
  ArrecadacoesService: class {
    resumo = resumoMock
  },
}))
vi.mock('../../services/saldo-orcamentario.js', () => ({
  SaldoOrcamentarioService: class {
    calcular = calcularMock
  },
}))
vi.mock('../../services/relatorio-pdf.js', () => ({ gerarPdf: gerarPdfMock }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appRelatoriosOrcamentoRoutes } from '../relatorios-orcamento.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = { nome: 'Prefeitura de Maringá', brasao: null, municipio: { nome: 'Maringá', estado: { sigla: 'PR' } } }

const RESUMO_OK = {
  temOrcamento: true,
  resumo: { previsto: 1000, arrecadado: 0, saldo: 1000 },
  porConta: [
    { id: 'c1', codigo: '1', rotulo: 'RECEITAS CORRENTES', nivel: 1, previsto: 800, arrecadado: 0, saldo: 800 },
    { id: 'c2', codigo: '2', rotulo: 'RECEITAS DE CAPITAL', nivel: 1, previsto: 200, arrecadado: 0, saldo: 200 },
  ],
  porFonte: [{ id: 'f1', codigo: '000', rotulo: 'Ordinários', nivel: 1, previsto: 1000, arrecadado: 0, saldo: 1000 }],
}

describe('appRelatoriosOrcamentoRoutes', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    resumoMock.mockReset()
    calcularMock.mockReset()
    gerarPdfMock.mockReset()
    ;({ app, prisma } = await criarApp({
      registrar: appRelatoriosOrcamentoRoutes,
      comView: true,
      simularUsuario: { sub: 'u1', email: 'u@x.com' },
      simularContexto: { entidadeId: 'ent1', ano: 2026, nivel: 'ESCRITA' },
    }))
  })

  describe('GET tela', () => {
    it('renderiza o demonstrativo quando há orçamento', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      resumoMock.mockResolvedValue(RESUMO_OK)
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Demonstrativo da Receita Orçada — LOA 2026')
      expect(res.body).toContain('RECEITAS CORRENTES')
      expect(res.body).toContain('Baixar PDF')
    })

    it('mostra aviso quando não há orçamento', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      resumoMock.mockResolvedValue({ temOrcamento: false, resumo: { previsto: 0, arrecadado: 0, saldo: 0 }, porConta: [], porFonte: [] })
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Não há orçamento')
      expect(res.body).not.toContain('Baixar PDF')
    })
  })

  describe('GET .pdf', () => {
    it('gera o PDF quando há orçamento', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      resumoMock.mockResolvedValue(RESUMO_OK)
      gerarPdfMock.mockResolvedValue(Buffer.from('%PDF-1.7 fake'))
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista.pdf' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('application/pdf')
      expect(gerarPdfMock).toHaveBeenCalledOnce()
      const corpo = gerarPdfMock.mock.calls[0][0].corpoHtml
      expect(corpo).toContain('Demonstrativo da Receita Orçada')
    })

    it('redireciona para a tela quando não há orçamento', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      resumoMock.mockResolvedValue({ temOrcamento: false, resumo: { previsto: 0, arrecadado: 0, saldo: 0 }, porConta: [], porFonte: [] })
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista.pdf' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/orcamento/relatorios/receita-prevista')
      expect(gerarPdfMock).not.toHaveBeenCalled()
    })
  })

  describe('Despesa fixada', () => {
    const SALDO_OK = {
      temOrcamento: true,
      resumo: { autorizado: 1000, reservado: 0, empenhado: 0, disponivel: 1000 },
      porUnidade: [{ id: 'u', codigo: '02', rotulo: 'GABINETE', nivel: 1, autorizado: 1000, reservado: 0, empenhado: 0, disponivel: 1000 }],
      porFuncao: [{ id: 'f', codigo: '04', rotulo: 'Administração', nivel: 1, autorizado: 1000, reservado: 0, empenhado: 0, disponivel: 1000 }],
      porConta: [{ id: 'c', codigo: '3', rotulo: 'DESPESAS CORRENTES', nivel: 1, autorizado: 1000, reservado: 0, empenhado: 0, disponivel: 1000 }],
      porFonte: [{ id: 's', codigo: '000', rotulo: 'Ordinários', nivel: 1, autorizado: 1000, reservado: 0, empenhado: 0, disponivel: 1000 }],
    }

    it('renderiza o demonstrativo quando há orçamento', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      calcularMock.mockResolvedValue(SALDO_OK)
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/despesa-fixada' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Demonstrativo da Despesa Fixada — LOA 2026')
      expect(res.body).toContain('GABINETE')
      expect(res.body).toContain('Baixar PDF')
    })

    it('mostra aviso quando não há orçamento', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      calcularMock.mockResolvedValue({ temOrcamento: false, resumo: { autorizado: 0, reservado: 0, empenhado: 0, disponivel: 0 }, porUnidade: [], porFuncao: [], porConta: [], porFonte: [] })
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/despesa-fixada' })
      expect(res.body).toContain('Não há orçamento')
    })

    it('gera o PDF quando há orçamento', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      calcularMock.mockResolvedValue(SALDO_OK)
      gerarPdfMock.mockResolvedValue(Buffer.from('%PDF fake'))
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/despesa-fixada.pdf' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('application/pdf')
      expect(gerarPdfMock.mock.calls[0][0].corpoHtml).toContain('Demonstrativo da Despesa Fixada')
    })

    it('redireciona quando não há orçamento (.pdf)', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      calcularMock.mockResolvedValue({ temOrcamento: false, resumo: { autorizado: 0, reservado: 0, empenhado: 0, disponivel: 0 }, porUnidade: [], porFuncao: [], porConta: [], porFonte: [] })
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/despesa-fixada.pdf' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/orcamento/relatorios/despesa-fixada')
    })
  })
})
