import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Naviraí/MS (fabricante ELOTECH, produto OXY). Primeiro município fora
 * do PR importado pelo conversor via portal do fabricante: API aberta em
 * `navirai.oxy.elotech.com.br` (v3.111). MS herda o modelo contábil STN default
 * (mesmo do Criciúma/SC). Receita + despesa (com execução) 100% do portal —
 * `tce:'portal'`, dispensando o SICONFI. Fonte da despesa em 9999 (portal não
 * publica fonte por dotação). Decretos fora. Ver [[conversor-turn-key-tracker]].
 *
 * Cada FUNDO é um órgão DISJUNTO da Prefeitura (Pref=órgão 01, FMS=órgão 10, …),
 * então entra como entidade própria — soma das entidades = total do município, sem
 * duplicar. Os 2 fundos vazios do portal (Investimento Social id=8, Desenv.
 * Econômico id=10) ficam de fora. `tipo:'ADM_INDIRETA'` é o balde do Gênesis p/
 * fundos/autarquias (a enum não distingue fundo especial de autarquia).
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
    { nome: 'Fundação de Cultura de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '4' } },
    { nome: 'Fundo Municipal de Saúde de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '6' } },
    { nome: 'Fundo Municipal de Assistência Social de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '7' } },
    { nome: 'Fundo Municipal da Criança e do Adolescente de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '9' } },
    { nome: 'FUNDEB de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '11' } },
    { nome: 'Fundo Municipal de Meio Ambiente de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '12' } },
    { nome: 'Fundo Municipal dos Direitos da Pessoa com Deficiência de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '13' } },
    { nome: 'Fundo Municipal de Habitação de Interesse Social de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '14' } },
    { nome: 'Fundo Municipal Direitos Difusos de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '15' } },
    { nome: 'Fundo Municipal dos Direitos da Pessoa Idosa de Naviraí', tipo: 'ADM_INDIRETA', params: { idPortal: '17' } },
  ],
}
