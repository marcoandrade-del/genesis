import type { ConectorFabricante } from '../nucleo/tipos.js'
import { conectorIpm } from './ipm/conector.js'

/** Registro de conectores por FABRICANTE. Adicionar Elotech/Betha/... aqui. */
export const conectores: Record<string, ConectorFabricante> = {
  ipm: conectorIpm,
}
