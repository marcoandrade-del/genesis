import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Naviraí/MS (fabricante ELOTECH, produto OXY). Primeiro município fora
 * do PR importado pelo conversor via portal do fabricante: API aberta em
 * `navirai.oxy.elotech.com.br` (v3.111). MS herda o modelo contábil STN default
 * (mesmo do Criciúma/SC). Receita + despesa (com execução) 100% do portal —
 * `tce:'portal'`, dispensando o SICONFI. Fonte da despesa em 9999 (portal não
 * publica fonte por dotação). Decretos fora. Ver [[conversor-turn-key-tracker]].
 *
 * Núcleo importado (Prefeitura/Câmara/Previdência); os fundos municipais (saúde,
 * assistência, FUNDEB, …) são entidades separadas no portal — deferidos.
 */
export const naviraiMs: MunicipioConfig = {
  nome: 'Naviraí',
  ibge: '5005707',
  uf: 'MS',
  ano: 2026,
  fabricante: 'elotech',
  tce: 'portal',
  pularCreditos: true,
  portalUrl: 'https://navirai.oxy.elotech.com.br/portaltransparencia-api',
  entidades: [
    { nome: 'Prefeitura Municipal de Naviraí', tipo: 'PREFEITURA', params: { idPortal: '1' } },
    { nome: 'Câmara Municipal de Naviraí', tipo: 'CAMARA', params: { idPortal: '2' } },
    { nome: 'Previdência dos Servidores Públicos de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '3' } },
  ],
}
