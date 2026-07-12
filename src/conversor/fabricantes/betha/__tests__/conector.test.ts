import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MunicipioConfig, EntidadeConfig } from '../../../nucleo/tipos.js'

// Mocka o transporte de rede (dados-abertos) — os testes validam o MAPEAMENTO
// coluna→PCASP e o comportamento "falha alto", sem tocar a rede.
const lerConsulta = vi.fn()
vi.mock('../dados-abertos.js', () => ({ lerConsulta: (...a: unknown[]) => lerConsulta(...a) }))

const { conectorBetha } = await import('../conector.js')

const cfg = { portalUrl: 'https://dados.x/base', ano: 2026 } as MunicipioConfig
const ent = (params: Record<string, string>): EntidadeConfig => ({ nome: 'Prefeitura', tipo: 'PREFEITURA', params })

beforeEach(() => lerConsulta.mockReset())

describe('betha · conector (mapeamento dados-abertos → PCASP)', () => {
  it('mapeia a receita (natureza+fonte+valores) e ignora linhas zeradas', async () => {
    lerConsulta.mockResolvedValue([
      { naturezaReceita: '1.7.1.8.01.1.1', fonteRecurso: '1500', descricaoFonteRecurso: 'Recursos Ordinários', valorPrevisto: '1.234.567,89', valorArrecadado: 100.5 },
      { naturezaReceita: '1.1.1.0', fonteRecurso: '1500', descricaoFonteRecurso: 'Recursos Ordinários', valorPrevisto: 0, valorArrecadado: 0 },
    ])
    const linhas = await conectorBetha.lerReceita(cfg, ent({ consultaReceita: '10' }))
    expect(lerConsulta).toHaveBeenCalledWith('https://dados.x/base', '10')
    expect(linhas).toEqual([
      {
        naturezaPcasp: '1.7.1.8.01.1.1.00.00.00.00.00',
        fonte: { codigo: '1500', descricao: 'Recursos Ordinários' },
        previsto: 123456789,
        arrecadado: 10050,
      },
    ])
  })

  it('mapeia a despesa (dimensões + natureza no elemento + fonte)', async () => {
    lerConsulta.mockResolvedValue([
      {
        codigoOrgao: '02', nomeOrgao: 'Executivo',
        codigoUnidade: '010', nomeUnidade: 'Gabinete',
        funcao: '4', subfuncao: '122', programa: '2', codigoAcao: '2001', nomeAcao: 'Manutenção',
        naturezaDespesa: '3.3.90.30.01', fonteRecurso: '1500', valorFixado: '5.000,00',
      },
    ])
    const linhas = await conectorBetha.lerDespesa(cfg, ent({ consultaDespesa: '20' }))
    expect(linhas).toEqual([
      {
        orgao: { codigo: '02', nome: 'Executivo' },
        unidade: { codigo: '010', nome: 'Gabinete' },
        funcao: '04',
        subfuncao: '122',
        programa: { codigo: '0002' },
        acao: { codigo: '2001', nome: 'Manutenção' },
        naturezaPcasp: '3.3.90.30.00.00',
        fonte: { codigo: '1500', descricao: '1500' },
        autorizado: 500000,
      },
    ])
  })

  it('FALHA ALTO listando as colunas quando falta uma coluna obrigatória', async () => {
    lerConsulta.mockResolvedValue([{ codigoDaReceita: '1.1', valorPrevisto: 10 }])
    await expect(conectorBetha.lerReceita(cfg, ent({ consultaReceita: '10' }))).rejects.toThrow(/Colunas disponíveis: codigoDaReceita, valorPrevisto/)
  })

  it('não busca a rede sem consultaId/base configurados', async () => {
    expect(await conectorBetha.lerReceita(cfg, ent({}))).toEqual([])
    expect(await conectorBetha.lerDespesa(cfg, ent({}))).toEqual([])
    expect(lerConsulta).not.toHaveBeenCalled()
  })
})
