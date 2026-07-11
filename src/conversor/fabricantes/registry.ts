import type { ConectorFabricante } from '../nucleo/tipos.js'
import { conectorIpm } from './ipm/conector.js'
import { conectorElotech } from './elotech/conector.js'

/** Registro de conectores por FABRICANTE. Adicionar Betha/GovBR/... aqui. */
export const conectores: Record<string, ConectorFabricante> = {
  ipm: conectorIpm,
  elotech: conectorElotech,
}
