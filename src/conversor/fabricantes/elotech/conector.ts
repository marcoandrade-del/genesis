import type { ConectorFabricante, MunicipioConfig, EntidadeConfig, LinhaReceita, LinhaDespesa } from '../../nucleo/tipos.js'
import { lerReceita, lerDespesa } from './portal.js'

/**
 * Conector do FABRICANTE ELOTECH (Portal da Transparência / OXY). Ao contrário
 * do IPM (export CSV/XLS, captcha-walled), a Elotech expõe uma API aberta — o
 * conector BUSCA da rede por entidade + exercício e devolve linhas já em PCASP.
 *
 * Config:
 *   cfg.portalUrl          → base da API (…/portaltransparencia-api)
 *   ent.params.idPortal    → id da entidade no portal (1=Prefeitura, …)
 */
export const conectorElotech: ConectorFabricante = {
  nome: 'Elotech (Portal da Transparência)',

  async lerReceita(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaReceita[]> {
    const base = cfg.portalUrl
    const idPortal = ent.params?.idPortal
    if (!base || !idPortal) return []
    return lerReceita(base, cfg.ano, idPortal)
  },

  async lerDespesa(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaDespesa[]> {
    const base = cfg.portalUrl
    const idPortal = ent.params?.idPortal
    if (!base || !idPortal) return []
    return lerDespesa(base, cfg.ano, idPortal)
  },
}
