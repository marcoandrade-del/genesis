import type { ConectorFabricante } from '../nucleo/tipos.js'
import { conectorIpm } from './ipm/conector.js'
import { conectorElotech } from './elotech/conector.js'
import { conectorBetha } from './betha/conector.js'

/** Registro de conectores por FABRICANTE. Adicionar GovBR/Equiplano/... aqui. */
export const conectores: Record<string, ConectorFabricante> = {
  ipm: conectorIpm,
  elotech: conectorElotech,
  betha: conectorBetha,
}
