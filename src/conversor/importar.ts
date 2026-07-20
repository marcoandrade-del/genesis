import { PrismaClient } from '@prisma/client'
import type { MunicipioConfig } from './nucleo/tipos.js'
import { garantirMunicipio, garantirEntidade } from './nucleo/onboarding.js'
import { escreverReceita } from './nucleo/escrever-receita.js'
import { escreverDespesa } from './nucleo/escrever-despesa.js'
import { reconciliarDespesa } from './nucleo/reconciliar.js'
import { conectores } from './fabricantes/registry.js'
import { fontesExecucao } from './tce/registry.js'

/**
 * Orquestrador do conversor: dado o config de um MUNICÍPIO, escolhe o conector
 * do fabricante + a fonte de execução do TCE e roda o pipeline por entidade:
 * onboarding → receita (previsão+arrecadação) → despesa (orçado LOA + empenhado
 * TCE, reconciliados). Tudo agnóstico: a lógica não sabe de qual fabricante veio.
 */
export async function importarMunicipio(
  prisma: PrismaClient,
  cfg: MunicipioConfig,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const conector = conectores[cfg.fabricante]
  const fonteExec = fontesExecucao[cfg.tce]
  if (!conector) throw new Error(`Fabricante '${cfg.fabricante}' sem conector registrado.`)
  if (!fonteExec) throw new Error(`TCE '${cfg.tce}' sem fonte de execução registrada.`)
  log(`═══ ${cfg.nome}/${cfg.uf} ${cfg.ano} — fabricante ${conector.nome} · execução ${fonteExec.nome} ═══`)

  const municipioId = await garantirMunicipio(prisma, cfg)
  for (const ent of cfg.entidades) {
    const { entidadeId, orcamentoId } = await garantirEntidade(prisma, cfg, municipioId, ent)

    const receita = await conector.lerReceita(cfg, ent)
    if (receita.length) await escreverReceita(prisma, orcamentoId, entidadeId, cfg.ano, receita)

    const loa = await conector.lerDespesa(cfg, ent)
    const exec = await fonteExec.lerExecucao(cfg, ent)
    const merged = reconciliarDespesa(loa, exec)
    const d = merged.length ? await escreverDespesa(prisma, orcamentoId, entidadeId, cfg.ano, merged) : { dotacoes: 0, comEmpenho: 0, semConta: [] as string[] }

    log(`  ${ent.nome}: previsões ${receita.length} · dotações ${merged.length} (com empenho ${d.comEmpenho})${d.semConta.length ? ` · SEM conta ${d.semConta.length}` : ''}`)

    // FASE 2 (opcional): créditos adicionais (decretos) do portal → autorizado.
    // Só fabricantes com API de decretos (ex.: Elotech) implementam; a LOA (fase 1)
    // já está gravada acima.
    if (conector.sincronizarCreditos) {
      const rc = await conector.sincronizarCreditos(prisma, cfg, ent, entidadeId)
      log(`    créditos (decretos): ${rc.status} — ${rc.mensagem}`)
    }
  }
}
