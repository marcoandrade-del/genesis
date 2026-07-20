import type { PrismaClient } from '@prisma/client'
import type { ConectorFabricante, MunicipioConfig, EntidadeConfig, LinhaReceita, LinhaDespesa, ResultadoCreditos } from '../../nucleo/tipos.js'
import { lerReceita, lerDespesa } from './portal.js'
import { SincronizacaoDecretosService } from '../../../services/sincronizacao-decretos.js'

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

  /**
   * FASE 2: aplica os créditos adicionais (decretos) do portal Elotech sobre o
   * autorizado (a LOA inicial já foi gravada). Reusa o `SincronizacaoDecretosService`
   * config-driven (solver incremental + guards). Idempotente por nº de decreto.
   */
  async sincronizarCreditos(prisma: PrismaClient, cfg: MunicipioConfig, ent: EntidadeConfig, entidadeId: string): Promise<ResultadoCreditos> {
    const idPortal = ent.params?.idPortal
    if (!cfg.portalUrl || !idPortal) return { status: 'OK', mensagem: 'sem portalUrl/idPortal — nada a sincronizar', valorGravado: 0 }
    const svc = new SincronizacaoDecretosService(prisma, { portalUrl: cfg.portalUrl, entidadePortal: idPortal })
    const r = await svc.sincronizar(entidadeId, cfg.ano)
    return { status: r.status, mensagem: r.mensagem, valorGravado: r.valorGravado }
  },
}
