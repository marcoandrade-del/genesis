import type { FonteExecucao } from '../nucleo/tipos.js'
import { pitTcePr } from './pr/pit.js'
import { siconfiExecucao } from './siconfi.js'
import { portalFabricante } from './portal.js'

/**
 * Registro de fontes de EXECUÇÃO. Chaveado por `cfg.tce`: os TCEs estaduais
 * (`pr`, ...), o `siconfi` — fonte NACIONAL por IBGE (baseline p/ qualquer
 * município) — e `portal` (no-op: execução já vem embutida na LOA do fabricante).
 */
export const fontesExecucao: Record<string, FonteExecucao> = {
  pr: pitTcePr,
  siconfi: siconfiExecucao,
  portal: portalFabricante,
}
