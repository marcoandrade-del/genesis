import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Criciúma/SC importado 100% do SICONFI (baseline nacional), sem raspar
 * ERP: `fabricante='siconfi'` (receita + dotação da MSC) + `tce='siconfi'`
 * (execução/empenho da MSC). Cobre QUALQUER município do Brasil trocando só o IBGE.
 *
 * O SICONFI só distingue as entidades por `poder_orgao` (a MSC não tem UO): 10131
 * = executivo consolidado (Prefeitura + fundos/autarquias juntos), 10132 = RPPS/
 * adm. indireta, 20231 = legislativo. Cada entidade fixa `matchSiconfi` (o poder) e
 * `nivelDespesa='modalidade'` — nível em que a MSC fixa a dotação, casando o
 * autorizado com o empenho na reconciliação. Ver [[msc-siconfi-fonte-oficial]].
 *
 * ⚠️ Baseline: despesa por função×subfunção×natureza(modalidade)×fonte, sem
 * programa/ação/UO (a MSC não os traz). O detalhe dimensional segue do fabricante
 * (Betha 174485). `mesSiconfi` ausente = último mês homologado (auto).
 */
export const criciumaSc: MunicipioConfig = {
  nome: 'Criciúma',
  ibge: '4204608',
  uf: 'SC',
  ano: 2026,
  fabricante: 'siconfi',
  tce: 'siconfi',
  entidades: [
    { nome: 'Prefeitura Municipal de Criciúma', tipo: 'PREFEITURA', matchSiconfi: '10131', params: { nivelDespesa: 'modalidade' } },
    { nome: 'Administração Indireta / RPPS de Criciúma (poder 10132)', tipo: 'ADM_INDIRETA', matchSiconfi: '10132', params: { nivelDespesa: 'modalidade' } },
    { nome: 'Câmara Municipal de Criciúma', tipo: 'CAMARA', matchSiconfi: '20231', params: { nivelDespesa: 'modalidade' } },
  ],
}
