import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Paranaguá/PR importada 100% do SICONFI (baseline nacional), como
 * alternativa AUTOMÁTICA ao conector IPM por arquivo (`paranagua-pr.ts`, exports
 * manuais do atende.net captcha-walled, QDD da Prefeitura incompleto). Ver
 * [[msc-siconfi-fonte-oficial]] e `municipios/criciuma-sc.ts`.
 *
 * ⚠️ O IBGE do SICONFI é **4118204** (7 díg. com verificador), não 4118203 — o
 * conector IPM usa o de 6 díg. (411820) p/ o PIT. As entidades saem por
 * `poder_orgao` (10131 executivo consolidado, 10132 RPPS, 20231 legislativo);
 * `nivelDespesa='modalidade'` casa o autorizado com o empenho.
 */
export const paranaguaSiconfi: MunicipioConfig = {
  nome: 'Paranaguá',
  ibge: '4118204',
  uf: 'PR',
  ano: 2026,
  fabricante: 'siconfi',
  tce: 'siconfi',
  entidades: [
    { nome: 'Prefeitura Municipal de Paranaguá', tipo: 'PREFEITURA', matchSiconfi: '10131', params: { nivelDespesa: 'modalidade' } },
    { nome: 'Paranaguá Previdência', tipo: 'ADM_INDIRETA', matchSiconfi: '10132', params: { nivelDespesa: 'modalidade' } },
    { nome: 'Câmara Municipal de Paranaguá', tipo: 'CAMARA', matchSiconfi: '20231', params: { nivelDespesa: 'modalidade' } },
  ],
}
