import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Paranaguá/PR (fabricante IPM). Os arquivos vêm de exports manuais do
 * portal atende.net (captcha-walled p/ HTTP puro). O .xls do balanço da receita
 * precisa ser convertido p/ .xlsx antes (libreoffice --convert-to xlsx).
 *
 * Câmara: só execução (o portal IPM não expõe QDD-com-fonte pra ela).
 * CAGEPAR: autarquia; só execução do PIT (QDD dela ainda não localizado).
 */
const DL = '/home/marco/Downloads'

export const paranaguaPr: MunicipioConfig = {
  nome: 'Paranaguá',
  ibge: '411820',
  uf: 'PR',
  ano: 2026,
  fabricante: 'ipm',
  tce: 'pr',
  portalUrl: 'https://paranagua.atende.net/transparencia/',
  entidades: [
    {
      nome: 'Prefeitura Municipal de Paranaguá',
      tipo: 'PREFEITURA',
      matchPit: 'MUNICÍPIO',
      params: { matchArquivo: 'MUNICIPIO', receitaCsv: `${DL}/Relatorio.csv`, arrecadacaoXlsx: `${DL}/Relatorio (3).xlsx`, despesaQdd: `${DL}/Relatorio (1).csv` },
    },
    {
      nome: 'Câmara Municipal de Paranaguá',
      tipo: 'CAMARA',
      matchPit: 'CÂMARA',
      params: {},
    },
    {
      nome: 'Paranaguá Previdência',
      tipo: 'ADM_INDIRETA',
      matchPit: 'PREVIDÊNCIA',
      params: { matchArquivo: 'PREVIDENCIA', receitaCsv: `${DL}/Relatorio.csv`, arrecadacaoXlsx: `${DL}/Relatorio (1).xlsx`, despesaQdd: `${DL}/Relatorio (5).csv` },
    },
    {
      nome: 'Fundação de Assistência à Saúde de Paranaguá',
      tipo: 'ADM_INDIRETA',
      matchPit: '§SEM-PIT§', // não aparece no PIT
      params: { matchArquivo: 'FUNDA', receitaCsv: `${DL}/Relatorio.csv`, arrecadacaoXlsx: `${DL}/Relatorio (2).xlsx`, despesaQdd: `${DL}/Relatorio (6).csv` },
    },
    {
      nome: 'Central de Água, Esgoto e Serviços Concedidos do Litoral do Paraná (CAGEPAR)',
      tipo: 'ADM_INDIRETA',
      matchPit: 'CENTRAL',
      params: {},
    },
  ],
}
