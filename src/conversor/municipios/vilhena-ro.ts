import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Vilhena/RO (fabricante ELOTECH, produto OXY). Único self-hosted dos 4
 * do "teste de fogo": API em `transparencia.vilhena.ro.gov.br` (v3.111). RO herda
 * o modelo contábil STN default (mesmo do Criciúma/SC). Receita + despesa (com
 * execução) 100% do portal — `tce:'portal'`, sem SICONFI. Fonte da despesa em 9999.
 * Decretos fora. Ver [[conversor-turn-key-tracker]].
 *
 * Cada fundo/autarquia é um órgão DISJUNTO da Prefeitura (Pref=órgãos 02-19,
 * FMS=órgão 14, …) → entidade própria, soma = total do município sem duplicar.
 * SAAE é autarquia real; os "Fundo Municipal …" são fundos especiais — todos no
 * balde `ADM_INDIRETA` (a enum do Gênesis não os distingue).
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
    { nome: 'Fundação Cultural de Vilhena', tipo: 'ADM_INDIRETA', params: { idPortal: '2' } },
    { nome: 'Fundo Municipal de Saúde de Vilhena', tipo: 'ADM_INDIRETA', params: { idPortal: '3' } },
    { nome: 'SAAE — Serviço Autônomo de Águas e Esgotos de Vilhena', tipo: 'ADM_INDIRETA', params: { idPortal: '25' } },
    { nome: 'Fundo Municipal do Meio Ambiente de Vilhena', tipo: 'ADM_INDIRETA', params: { idPortal: '26' } },
    { nome: 'Fundo Municipal dos Direitos da Criança e do Adolescente de Vilhena', tipo: 'ADM_INDIRETA', params: { idPortal: '27' } },
    { nome: 'FUMAPI — Fundo Municipal de Apoio aos Direitos dos Idosos de Vilhena', tipo: 'ADM_INDIRETA', params: { idPortal: '28' } },
    { nome: 'FUMAS — Fundo Municipal de Assistência Social de Vilhena', tipo: 'ADM_INDIRETA', params: { idPortal: '29' } },
  ],
}
