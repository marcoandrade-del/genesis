import type { PrismaClient } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { parseComposicao, type ComposicaoRcl } from './rcl.js'
import { IaPreferenciaService } from './ia-preferencia.js'
import { MotorIaClientHttp, type MotorIaClient } from './ia-cliente.js'

const SYSTEM =
  'Você é um especialista em contabilidade pública brasileira e na Receita Corrente Líquida (LRF art. 2º, IV; RREO Anexo 3 da STN). ' +
  'Sua tarefa é, a partir da memória de cálculo de um Tribunal de Contas, identificar as DEDUÇÕES da RCL e os PREFIXOS de código de natureza de receita de cada uma. Responda SOMENTE com JSON.'

function montarPrompt(planilhaTexto: string): string {
  return (
    'A planilha abaixo é a memória de cálculo da RCL de um Tribunal de Contas (TCE). ' +
    'Identifique a metodologia e as DEDUÇÕES da RCL; para cada dedução, dê o rótulo e os PREFIXOS de código de natureza de receita que a compõem (ex.: "1.7.5.1.50"). ' +
    'Responda APENAS com um JSON no formato EXATO, sem texto fora dele e sem cercas de código:\n' +
    '{"nome":"<nome da metodologia>","deducoes":[{"rotulo":"<texto>","prefixos":["<prefixo>", "..."]}]}\n\n' +
    'PLANILHA:\n' +
    planilhaTexto
  )
}

/** Extrai o objeto JSON da resposta da IA (tolera cercas ```json e texto ao redor). */
function extrairJson(texto: string): unknown {
  let t = texto.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) t = fence[1].trim()
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  if (i >= 0 && j > i) t = t.slice(i, j + 1)
  return JSON.parse(t)
}

/**
 * Propõe a composição da RCL a partir da planilha do TCE, via IA — usando o motor
 * preferido do usuário (IaPreferenciaService). A IA só PROPÕE; quem confirma é o
 * admin (revisão na tela). A saída é SEMPRE validada por `parseComposicao` (reuso);
 * resposta inválida → 1 retry e, persistindo, erro claro.
 */
export class RclImportIaService {
  private readonly prefs: IaPreferenciaService

  constructor(
    prisma: PrismaClient,
    private readonly ia: MotorIaClient = new MotorIaClientHttp(),
  ) {
    this.prefs = new IaPreferenciaService(prisma)
  }

  async proporComposicao(usuarioId: string, planilhaTexto: string): Promise<ComposicaoRcl> {
    if (!planilhaTexto.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Planilha vazia.')
    const { motor } = await this.prefs.ler(usuarioId)
    const prompt = montarPrompt(planilhaTexto)

    let ultimaFalha = 'resposta sem deduções válidas'
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      // chamar() fora do try: erro de configuração/rede (IA_NAO_CONFIGURADA/IA_FALHOU) propaga direto.
      const { texto } = await this.ia.chamar({ motorId: motor, system: SYSTEM, user: prompt, maxTokens: 4096 })
      try {
        const comp = parseComposicao(extrairJson(texto))
        if (comp) return comp
      } catch (e) {
        ultimaFalha = e instanceof Error ? e.message : 'JSON inválido'
      }
    }
    throw new ErroNegocio(
      'IA_FALHOU',
      `A IA não retornou uma composição válida (${ultimaFalha}). Tente outra planilha ou edite manualmente.`,
    )
  }
}
