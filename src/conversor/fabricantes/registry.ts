import type { ConectorFabricante } from '../nucleo/tipos.js'
import { conectorIpm } from './ipm/conector.js'
import { conectorElotech } from './elotech/conector.js'
import { conectorBetha } from './betha/conector.js'
import { siconfiConector } from './siconfi/conector.js'

/**
 * Registro de conectores do ORÇAMENTÁRIO. Os fabricantes de ERP (ipm/elotech/
 * betha/...) e o `siconfi` — baseline NACIONAL por IBGE (lê a receita direto da
 * MSC do Tesouro, sem raspar ERP).
 */
export const conectores: Record<string, ConectorFabricante> = {
  ipm: conectorIpm,
  elotech: conectorElotech,
  betha: conectorBetha,
  siconfi: siconfiConector,
}
