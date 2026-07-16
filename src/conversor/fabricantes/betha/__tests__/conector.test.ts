import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MunicipioConfig, EntidadeConfig } from '../../../nucleo/tipos.js'

// RECEITA: API real (busca-textual). Mocka só o transporte `lerConsulta`; mantém
// as puras `entidadeDoId`/`mesDoId` reais (importActual).
const lerBusca = vi.fn()
vi.mock('../api.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), lerConsulta: (...a: unknown[]) => lerBusca(...a) }))

// DESPESA (legado, a migrar): mocka o transporte antigo do dados-abertos.
const lerConsulta = vi.fn()
vi.mock('../dados-abertos.js', () => ({ lerConsulta: (...a: unknown[]) => lerConsulta(...a) }))

const { conectorBetha } = await import('../conector.js')

const cfg = { portalUrl: 'https://dados.x/base', ano: 2026 } as MunicipioConfig
const ent = (params: Record<string, string>): EntidadeConfig => ({ nome: 'Prefeitura', tipo: 'PREFEITURA', params })

beforeEach(() => {
  lerBusca.mockReset()
  lerConsulta.mockReset()
})

describe('betha · receita (busca-textual → PCASP)', () => {
  it('agrega por entidade×natureza somando os meses (orçado e arrecadado), filtrando a entidade', async () => {
    lerBusca.mockResolvedValue([
      { id: '26:184:receita_orcamentaria_2026_01_1984_17180111', campos: { rubricaNatureza: '17180111', valorOrcadoAtualizado: 1000, valorArrecadadoNoMes: 100 } },
      { id: '26:184:receita_orcamentaria_2026_02_1984_17180111', campos: { rubricaNatureza: '17180111', valorOrcadoAtualizado: 1200, valorArrecadadoNoMes: 50 } },
      // outra entidade (29) — filtrada fora por entidadeBetha=184
      { id: '26:29:receita_orcamentaria_2026_01_29_17180111', campos: { rubricaNatureza: '17180111', valorOrcadoAtualizado: 999, valorArrecadadoNoMes: 999 } },
    ])
    const linhas = await conectorBetha.lerReceita(cfg, ent({ portalHash: 'HASH', consultaReceita: '34858', entidadeBetha: '184' }))
    expect(lerBusca).toHaveBeenCalledWith({ consultaId: '34858', portalHash: 'HASH', filtros: { ano: ['2026'] } })
    expect(linhas).toEqual([
      {
        naturezaPcasp: '1.7.1.8.01.1.1.00.00.00.00.00',
        fonte: { codigo: '9999', descricao: 'Fonte não discriminada (dados-abertos Betha)' },
        previsto: 220000, // 1000 + 1200 (soma dos meses, como o portal totaliza)
        arrecadado: 15000, // 100 + 50
      },
    ])
  })

  it('dropa o indicador da rubrica quando a categoria fica válida (413… → 1.3.2.5…)', async () => {
    lerBusca.mockResolvedValue([
      { id: '26:184:receita_orcamentaria_2026_01_1984_413250124000000', campos: { rubricaNatureza: '413250124000000', valorArrecadadoNoMes: 860.94 } },
    ])
    const [linha] = await conectorBetha.lerReceita(cfg, ent({ portalHash: 'H', consultaReceita: '34858' }))
    expect(linha!.naturezaPcasp).toBe('1.3.2.5.01.2.4.00.00.00.00.00')
    expect(linha!.arrecadado).toBe(86094)
  })

  it('FALHA ALTO listando as colunas quando falta a natureza', async () => {
    lerBusca.mockResolvedValue([{ id: '26:184:receita_orcamentaria_2026_01_1984_x', campos: { valorArrecadadoNoMes: 10 } }])
    await expect(conectorBetha.lerReceita(cfg, ent({ portalHash: 'H', consultaReceita: '10' }))).rejects.toThrow(/Colunas disponíveis: valorArrecadadoNoMes/)
  })

  it('não busca a rede sem portalHash/consultaReceita', async () => {
    expect(await conectorBetha.lerReceita(cfg, ent({}))).toEqual([])
    expect(await conectorBetha.lerReceita(cfg, ent({ portalHash: 'H' }))).toEqual([])
    expect(lerBusca).not.toHaveBeenCalled()
  })
})

describe('betha · despesa (legado dados-abertos — a migrar)', () => {
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

  it('não busca a rede sem consultaId/base', async () => {
    expect(await conectorBetha.lerDespesa(cfg, ent({}))).toEqual([])
    expect(lerConsulta).not.toHaveBeenCalled()
  })
})
