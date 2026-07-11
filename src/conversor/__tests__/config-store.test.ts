import { describe, it, expect } from 'vitest'
import { paraMunicipioConfig, type MunicipioRow } from '../config-store.js'

describe('config-store · paraMunicipioConfig', () => {
  const row: MunicipioRow = {
    nome: 'Paranaguá',
    ibge: '411820',
    uf: 'PR',
    ano: 2026,
    fabricante: 'ipm',
    tce: 'pr',
    portalUrl: 'https://paranagua.atende.net/transparencia/',
    params: { receitaCsv: '/data/conversor/411820/mun-receitaCsv.csv' },
    entidades: [
      { nome: 'Câmara', tipo: 'CAMARA', matchPit: 'CÂMARA', params: {}, ordem: 1 },
      {
        nome: 'Prefeitura',
        tipo: 'PREFEITURA',
        matchPit: 'MUNICÍPIO',
        params: { matchArquivo: 'MUNICIPIO', despesaQdd: '/data/conversor/411820/ent-x-despesaQdd.csv' },
        ordem: 0,
      },
    ],
  }

  it('mapeia os campos do município', () => {
    const cfg = paraMunicipioConfig(row)
    expect(cfg.nome).toBe('Paranaguá')
    expect(cfg.ibge).toBe('411820')
    expect(cfg.fabricante).toBe('ipm')
    expect(cfg.tce).toBe('pr')
    expect(cfg.portalUrl).toBe('https://paranagua.atende.net/transparencia/')
  })

  it('ordena as entidades por `ordem`', () => {
    const cfg = paraMunicipioConfig(row)
    expect(cfg.entidades.map((e) => e.nome)).toEqual(['Prefeitura', 'Câmara'])
  })

  it('mescla os params de escopo município sob os da entidade', () => {
    const cfg = paraMunicipioConfig(row)
    const pref = cfg.entidades.find((e) => e.nome === 'Prefeitura')!
    // recebe o receitaCsv compartilhado (município) + o próprio matchArquivo/despesaQdd
    expect(pref.params).toMatchObject({
      receitaCsv: '/data/conversor/411820/mun-receitaCsv.csv',
      matchArquivo: 'MUNICIPIO',
      despesaQdd: '/data/conversor/411820/ent-x-despesaQdd.csv',
    })
    // a Câmara (sem params próprios) ainda enxerga o compartilhado
    const camara = cfg.entidades.find((e) => e.nome === 'Câmara')!
    expect(camara.params).toEqual({ receitaCsv: '/data/conversor/411820/mun-receitaCsv.csv' })
  })

  it('a entidade sobrescreve o município em caso de colisão de chave', () => {
    const r: MunicipioRow = {
      ...row,
      params: { receitaCsv: '/mun/compartilhado.csv' },
      entidades: [{ nome: 'E', tipo: 'ADM_INDIRETA', matchPit: null, params: { receitaCsv: '/proprio.csv' }, ordem: 0 }],
    }
    expect(paraMunicipioConfig(r).entidades[0]!.params!.receitaCsv).toBe('/proprio.csv')
  })

  it('omite portalUrl/matchPit nulos', () => {
    const r: MunicipioRow = {
      ...row,
      portalUrl: null,
      params: {},
      entidades: [{ nome: 'E', tipo: 'ADM_INDIRETA', matchPit: null, params: {}, ordem: 0 }],
    }
    const cfg = paraMunicipioConfig(r)
    expect(cfg.portalUrl).toBeUndefined()
    expect(cfg.entidades[0]!.matchPit).toBeUndefined()
  })
})
