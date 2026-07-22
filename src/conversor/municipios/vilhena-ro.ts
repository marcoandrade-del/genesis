import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Vilhena/RO (fabricante ELOTECH, produto OXY). Único self-hosted dos 4
 * do "teste de fogo": API em `transparencia.vilhena.ro.gov.br` (v3.111). RO herda
 * o modelo contábil STN default (mesmo do Criciúma/SC). Receita + despesa (com
 * execução) 100% do portal — `tce:'portal'`, sem SICONFI. Fonte da despesa em 9999.
 * Decretos fora. Ver [[conversor-turn-key-tracker]].
 *
 * Núcleo importado (Prefeitura/Câmara/Previdência); Fundação, FMS, SAAE e demais
 * fundos são entidades separadas no portal — deferidos.
 */
export const vilhenaRo: MunicipioConfig = {
  nome: 'Vilhena',
  ibge: '1100304',
  uf: 'RO',
  ano: 2026,
  fabricante: 'elotech',
  tce: 'portal',
  pularCreditos: true,
  portalUrl: 'https://transparencia.vilhena.ro.gov.br/portaltransparencia-api',
  entidades: [
    { nome: 'Prefeitura Municipal de Vilhena', tipo: 'PREFEITURA', params: { idPortal: '1' } },
    { nome: 'Câmara Municipal de Vilhena', tipo: 'CAMARA', params: { idPortal: '14' } },
    { nome: 'Instituto de Previdência Municipal de Vilhena', tipo: 'ADM_INDIRETA', params: { idPortal: '16' } },
  ],
}
