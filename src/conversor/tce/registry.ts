import type { FonteExecucao } from '../nucleo/tipos.js'
import { pitTcePr } from './pr/pit.js'
import { siconfiExecucao } from './siconfi.js'

/**
 * Registro de fontes de EXECUÇÃO. Chaveado por `cfg.tce`: os TCEs estaduais
 * (`pr`, ...) e o `siconfi` — fonte NACIONAL por IBGE (baseline p/ qualquer
 * município, independente do estado).
 */
export const fontesExecucao: Record<string, FonteExecucao> = {
  pr: pitTcePr,
  siconfi: siconfiExecucao,
}
