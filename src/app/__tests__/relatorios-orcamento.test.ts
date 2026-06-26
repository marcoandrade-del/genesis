import { describe, it, expect, beforeEach, vi } from 'vitest'

const { resumoMock, calcularMock, ptMock, gerarPdfMock } = vi.hoisted(() => ({
  resumoMock: vi.fn(),
  calcularMock: vi.fn(),
  ptMock: vi.fn(),
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
vi.mock('../../services/programa-trabalho.js', () => ({
  ProgramaTrabalhoService: class {
    calcular = ptMock
  },
}))
vi.mock('../../services/relatorio-pdf.js', () => ({ gerarPdf: gerarPdfMock }))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import { appRelatoriosOrcamentoRoutes } from '../relatorios-orcamento.js'
import type { FastifyInstance } from 'fastify'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'

const ENTIDADE = {
  nome: 'Prefeitura de Maringá',
  brasao: null,
  municipio: {
    nome: 'Maringá',
    brasao: null, // sem brasão no município → cai no da entidade
    loaCodigoModo: null, // herda do estado
    loaCodigoNivel: null,
    estado: { sigla: 'PR', loaCodigoModo: 'CURTO', loaCodigoNivel: 4 },
  },
}

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
    ptMock.mockReset()
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
      expect(res.body).toContain('Resumo Geral da Receita')
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

    it('usa o brasão do município no cabeçalho dos anexos', async () => {
      const entBrasaoMun = {
        ...ENTIDADE,
        brasao: 'data:image/png;base64,ENT',
        municipio: { ...ENTIDADE.municipio, brasao: 'data:image/png;base64,MUN' },
      }
      prisma.entidade.findUnique.mockResolvedValue(entBrasaoMun)
      resumoMock.mockResolvedValue(RESUMO_OK)
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista' })
      expect(res.body).toContain('data:image/png;base64,MUN') // brasão do município tem prioridade
      expect(res.body).not.toContain('data:image/png;base64,ENT')
    })

    it('legenda mostra a lei quando o orçamento está publicado', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      prisma.orcamento.findUnique.mockResolvedValue({ status: 'PUBLICADO', leiNumero: '1695/2025' })
      resumoMock.mockResolvedValue(RESUMO_OK)
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista' })
      expect(res.body).toContain('Lei Orçamentária Anual nº 1695/2025')
    })

    it('o seletor de código e o parâmetro ?cod controlam o formato', async () => {
      const comZeros = {
        temOrcamento: true,
        resumo: { previsto: 10, arrecadado: 0, saldo: 10 },
        porConta: [{ id: 'c', codigo: '1.0.0.0.00', rotulo: 'Correntes', nivel: 1, previsto: 10, arrecadado: 0, saldo: 10 }],
        porFonte: [],
      }
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      resumoMock.mockResolvedValue(comZeros)
      const curto = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista' })
      expect(curto.body).toContain('Sem zeros à direita') // seletor presente
      expect(curto.body).not.toContain('1.0.0.0.00') // default = trimado

      resumoMock.mockResolvedValue(comZeros)
      const completo = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista?cod=completo' })
      expect(completo.body).toContain('1.0.0.0.00')

      resumoMock.mockResolvedValue(comZeros)
      const nivel = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista?cod=nivel&nivelMax=2' })
      expect(nivel.body).toContain('>1.0<') // cortado em 2 segmentos
      expect(nivel.body).not.toContain('1.0.0.0.00')
      expect(nivel.body).toContain('nivelMax=2') // o link do PDF carrega o formato
    })

    it('herança: município sobrescreve o padrão do estado (sem query)', async () => {
      const entOverride = {
        ...ENTIDADE,
        municipio: { ...ENTIDADE.municipio, loaCodigoModo: 'COMPLETO', loaCodigoNivel: 12 },
      }
      const comZeros = {
        temOrcamento: true,
        resumo: { previsto: 10, arrecadado: 0, saldo: 10 },
        porConta: [{ id: 'c', codigo: '1.0.0.0.00', rotulo: 'Correntes', nivel: 1, previsto: 10, arrecadado: 0, saldo: 10 }],
        porFonte: [],
      }
      prisma.entidade.findUnique.mockResolvedValue(entOverride)
      resumoMock.mockResolvedValue(comZeros)
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista' })
      expect(res.body).toContain('1.0.0.0.00') // município forçou COMPLETO mesmo sem ?cod
    })

    it('config do estado em NIVEL corta o código sem query', async () => {
      const entNivel = {
        ...ENTIDADE,
        municipio: {
          ...ENTIDADE.municipio,
          loaCodigoModo: null,
          loaCodigoNivel: null,
          estado: { sigla: 'PR', loaCodigoModo: 'NIVEL', loaCodigoNivel: 3 },
        },
      }
      const comZeros = {
        temOrcamento: true,
        resumo: { previsto: 10, arrecadado: 0, saldo: 10 },
        porConta: [{ id: 'c', codigo: '1.0.0.0.00', rotulo: 'X', nivel: 1, previsto: 10, arrecadado: 0, saldo: 0 }],
        porFonte: [],
      }
      prisma.entidade.findUnique.mockResolvedValue(entNivel)
      resumoMock.mockResolvedValue(comZeros)
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/receita-prevista' })
      expect(res.body).toContain('>1.0.0<') // cortado em 3 segmentos pela config do estado
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
      expect(corpo).toContain('Resumo Geral da Receita')
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
      expect(res.body).toContain('Demonstrativos da Despesa Fixada')
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
      expect(gerarPdfMock.mock.calls[0][0].corpoHtml).toContain('Demonstrativos da Despesa Fixada')
    })

    it('redireciona quando não há orçamento (.pdf)', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      calcularMock.mockResolvedValue({ temOrcamento: false, resumo: { autorizado: 0, reservado: 0, empenhado: 0, disponivel: 0 }, porUnidade: [], porFuncao: [], porConta: [], porFonte: [] })
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/despesa-fixada.pdf' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/orcamento/relatorios/despesa-fixada')
    })
  })

  describe('Programa de trabalho', () => {
    const PT_OK = {
      temOrcamento: true,
      total: 600,
      linhas: [
        { codigo: '02', rotulo: 'Gabinete', nivel: 1, valor: 600 },
        { codigo: '2001', rotulo: 'Gestão', nivel: 5, valor: 600 },
      ],
    }

    it('renderiza quando há orçamento', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      ptMock.mockResolvedValue(PT_OK)
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/programa-trabalho' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Anexo 6, da Lei nº 4.320/64 — Programa de Trabalho')
      expect(res.body).toContain('Gabinete')
      expect(res.body).toContain('Baixar PDF')
    })

    it('aviso quando não há orçamento', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      ptMock.mockResolvedValue({ temOrcamento: false, total: 0, linhas: [] })
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/programa-trabalho' })
      expect(res.body).toContain('Não há orçamento')
    })

    it('gera o PDF', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      ptMock.mockResolvedValue(PT_OK)
      gerarPdfMock.mockResolvedValue(Buffer.from('%PDF fake'))
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/programa-trabalho.pdf' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('application/pdf')
      expect(gerarPdfMock.mock.calls[0][0].corpoHtml).toContain('Programa de Trabalho')
    })

    it('redireciona quando não há orçamento (.pdf)', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      ptMock.mockResolvedValue({ temOrcamento: false, total: 0, linhas: [] })
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/programa-trabalho.pdf' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/orcamento/relatorios/programa-trabalho')
    })
  })

  describe('Sumário geral', () => {
    const REC = { temOrcamento: true, resumo: { previsto: 1000, arrecadado: 0, saldo: 1000 }, porConta: [], porFonte: [{ id: 'f', codigo: '000', rotulo: 'Ordinários', nivel: 1, previsto: 1000, arrecadado: 0, saldo: 1000 }] }
    const DESP = { temOrcamento: true, resumo: { autorizado: 900, reservado: 0, empenhado: 0, disponivel: 900 }, porUnidade: [], porFuncao: [{ id: 'fn', codigo: '04', rotulo: 'Administração', nivel: 1, autorizado: 900, reservado: 0, empenhado: 0, disponivel: 900 }], porConta: [], porFonte: [] }
    const VAZIO_REC = { temOrcamento: false, resumo: { previsto: 0, arrecadado: 0, saldo: 0 }, porConta: [], porFonte: [] }
    const VAZIO_DESP = { temOrcamento: false, resumo: { autorizado: 0, reservado: 0, empenhado: 0, disponivel: 0 }, porUnidade: [], porFuncao: [], porConta: [], porFonte: [] }

    it('renderiza receita por fonte + despesa por função', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      resumoMock.mockResolvedValue(REC)
      calcularMock.mockResolvedValue(DESP)
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/sumario' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('Sumário Geral da Receita por Fontes')
      expect(res.body).toContain('Ordinários')
      expect(res.body).toContain('Administração')
    })

    it('gera o PDF', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      resumoMock.mockResolvedValue(REC)
      calcularMock.mockResolvedValue(DESP)
      gerarPdfMock.mockResolvedValue(Buffer.from('%PDF fake'))
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/sumario.pdf' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('application/pdf')
    })

    it('redireciona quando não há orçamento (.pdf)', async () => {
      prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
      resumoMock.mockResolvedValue(VAZIO_REC)
      calcularMock.mockResolvedValue(VAZIO_DESP)
      const res = await app.inject({ method: 'GET', url: '/orcamento/relatorios/sumario.pdf' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/app/orcamento/relatorios/sumario')
    })
  })
})
