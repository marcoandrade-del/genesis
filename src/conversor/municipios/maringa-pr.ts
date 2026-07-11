import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Maringá/PR (fabricante ELOTECH). Diferente do Paranaguá (IPM, export
 * de arquivos), o Elotech tem API aberta — o conector busca da rede por
 * `params.idPortal` (id da entidade no portal) + exercício. `portalUrl` é a BASE
 * da API. Mapeamento portal→entidade validado ao centavo contra a LOA 2026
 * (Σ QDD das 6 entidades = 3.582.003.907,00). Ver [[maringa-municipio-completo]].
 *
 * `matchPit` (casamento no PIT do TCE-PR p/ a execução) é definido no cadastro —
 * a execução é agnóstica de fabricante (eixo TCE), separada do orçamentário.
 */
export const maringaPr: MunicipioConfig = {
  nome: 'Maringá',
  ibge: '4115200',
  uf: 'PR',
  ano: 2026,
  fabricante: 'elotech',
  tce: 'pr',
  portalUrl: 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api',
  entidades: [
    { nome: 'Prefeitura do Município de Maringá', tipo: 'PREFEITURA', params: { idPortal: '1' } },
    { nome: 'Câmara do Município de Maringá', tipo: 'CAMARA', params: { idPortal: '6' } },
    { nome: 'Maringá Previdência', tipo: 'ADM_INDIRETA', params: { idPortal: '3' } },
    { nome: 'Agência Maringaense de Regulação (AMR)', tipo: 'ADM_INDIRETA', params: { idPortal: '9' } },
    { nome: 'IPPLAM', tipo: 'ADM_INDIRETA', params: { idPortal: '15' } },
    { nome: 'Instituto Ambiental de Maringá (IAM)', tipo: 'ADM_INDIRETA', params: { idPortal: '4' } },
  ],
}
