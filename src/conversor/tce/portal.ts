import type { FonteExecucao } from '../nucleo/tipos.js'

/**
 * Fonte de EXECUÇÃO "portal": no-op. Alguns fabricantes (ex. Elotech) já publicam
 * empenhado/liquidado/pago nas MESMAS linhas da dotação — o conector devolve a
 * execução embutida na LOA (ver `fabricantes/elotech/portal.ts#lerDespesa`), e a
 * reconciliação com uma execução vazia apenas repassa a LOA-com-execução.
 *
 * Use `tce:'portal'` quando o orçamentário do fabricante já traz a execução, para
 * dispensar o TCE estadual (PIT) e o SICONFI — objetivo "100% pelo portal da
 * entidade" ([[conversor-turn-key-tracker]]).
 */
export const portalFabricante: FonteExecucao = {
  nome: 'Portal do fabricante (execução embutida)',
  async lerExecucao(): Promise<[]> {
    return []
  },
}
