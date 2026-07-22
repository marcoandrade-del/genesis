import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Cianorte/PR (fabricante ELOTECH, produto OXY). Descoberto no "teste de
 * fogo": API aberta em `cianorte.oxy.elotech.com.br`, versão 3.111. Receita
 * (previsão+arrecadação) e despesa (dotação + empenhado/liq/pago) vêm 100% do
 * portal — `tce:'portal'` (execução embutida na LOA, sem PIT/SICONFI). Fonte da
 * despesa cai em 9999 (o portal não publica fonte por dotação). Decretos fora
 * (`pularCreditos`). Ver [[conversor-turn-key-tracker]].
 */
export const cianortePr: MunicipioConfig = {
  nome: 'Cianorte',
  ibge: '4105508',
  uf: 'PR',
  ano: 2026,
  fabricante: 'elotech',
  tce: 'portal',
  pularCreditos: true,
  portalUrl: 'https://cianorte.oxy.elotech.com.br/portaltransparencia-api',
  entidades: [
    { nome: 'Prefeitura Municipal de Cianorte', tipo: 'PREFEITURA', params: { idPortal: '1' } },
    { nome: 'Câmara Municipal de Cianorte', tipo: 'CAMARA', params: { idPortal: '2' } },
    { nome: 'CAPSECI — Previdência dos Servidores de Cianorte', tipo: 'ADM_INDIRETA', params: { idPortal: '3' } },
  ],
}
