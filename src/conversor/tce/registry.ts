import type { FonteExecucao } from '../nucleo/tipos.js'
import { pitTcePr } from './pr/pit.js'

/** Registro de fontes de EXECUÇÃO por estado (TCE). Adicionar outros estados aqui. */
export const fontesExecucao: Record<string, FonteExecucao> = {
  pr: pitTcePr,
}
