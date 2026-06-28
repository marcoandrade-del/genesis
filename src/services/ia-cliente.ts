import { ErroNegocio } from '../errors.js'
import { IA_MOTORES } from './ia-preferencia.js'

/** Requisição genérica a um LLM (porta agnóstica de provedor). */
export interface ChamadaIa {
  motorId: string
  user: string
  system?: string
  maxTokens?: number
}
export interface RespostaIa {
  texto: string
}

/** Porta do cliente de IA — espelha o `ProviderClient` do Oxy. Injetável (testável). */
export interface MotorIaClient {
  chamar(req: ChamadaIa): Promise<RespostaIa>
}

const MAX_TOKENS_PADRAO = 4096
const TIMEOUT_MS = 60_000

interface ProvedorCfg {
  envKey: string
  modeloPadrao: string
  requisicao(chave: string, modelo: string, req: ChamadaIa): { url: string; init: RequestInit }
  extrairTexto(json: unknown): string
}

function textoOuFalha(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new ErroNegocio('IA_FALHOU', 'A IA retornou uma resposta vazia.')
  return v
}

// Endpoints/auth por provedor (fetch puro, sem SDK) — mesmos do Oxy.
const PROVEDORES: Record<string, ProvedorCfg> = {
  claude: {
    envKey: 'ANTHROPIC_API_KEY',
    modeloPadrao: 'claude-opus-4-8',
    requisicao: (chave, modelo, req) => ({
      url: 'https://api.anthropic.com/v1/messages',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: modelo,
          max_tokens: req.maxTokens ?? MAX_TOKENS_PADRAO,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: 'user', content: req.user }],
        }),
      },
    }),
    extrairTexto: (j) => textoOuFalha((j as { content?: { text?: string }[] }).content?.[0]?.text),
  },
  gemini: {
    envKey: 'GEMINI_API_KEY',
    modeloPadrao: 'gemini-2.5-pro',
    requisicao: (chave, modelo, req) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
        body: JSON.stringify({
          ...(req.system ? { system_instruction: { parts: [{ text: req.system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          generationConfig: { maxOutputTokens: req.maxTokens ?? MAX_TOKENS_PADRAO },
        }),
      },
    }),
    extrairTexto: (j) =>
      textoOuFalha((j as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text),
  },
  gpt: {
    envKey: 'OPENAI_API_KEY',
    modeloPadrao: 'gpt-4o',
    requisicao: (chave, modelo, req) => ({
      url: 'https://api.openai.com/v1/chat/completions',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
        body: JSON.stringify({
          model: modelo,
          max_tokens: req.maxTokens ?? MAX_TOKENS_PADRAO,
          messages: [...(req.system ? [{ role: 'system', content: req.system }] : []), { role: 'user', content: req.user }],
        }),
      },
    }),
    extrairTexto: (j) => textoOuFalha((j as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content),
  },
  sabia: {
    envKey: 'MARITACA_API_KEY',
    modeloPadrao: 'sabia-3',
    requisicao: (chave, modelo, req) => ({
      url: 'https://chat.maritaca.ai/api/chat/completions',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
        body: JSON.stringify({
          model: modelo,
          max_tokens: req.maxTokens ?? MAX_TOKENS_PADRAO,
          messages: [...(req.system ? [{ role: 'system', content: req.system }] : []), { role: 'user', content: req.user }],
        }),
      },
    }),
    extrairTexto: (j) => textoOuFalha((j as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content),
  },
}

const rotuloDe = (motorId: string): string => IA_MOTORES.find((m) => m.id === motorId)?.rotulo ?? motorId

/** Um motor está DISPONÍVEL quando existe no catálogo e tem a chave no `.env`. */
export function motorDisponivel(motorId: string): boolean {
  const cfg = PROVEDORES[motorId]
  return !!cfg && !!process.env[cfg.envKey]
}

/**
 * Cliente de LLM real (fetch). PLUGGÁVEL: motor sem chave → ErroNegocio('IA_NAO_CONFIGURADA')
 * (mensagem clara, não derruba o app). Falha de rede/HTTP → ErroNegocio('IA_FALHOU').
 */
export class MotorIaClientHttp implements MotorIaClient {
  async chamar(req: ChamadaIa): Promise<RespostaIa> {
    const cfg = PROVEDORES[req.motorId]
    if (!cfg) throw new ErroNegocio('IA_NAO_CONFIGURADA', `Motor de IA desconhecido: ${req.motorId}.`)
    const chave = process.env[cfg.envKey]
    if (!chave) throw new ErroNegocio('IA_NAO_CONFIGURADA', `IA por ${rotuloDe(req.motorId)} não configurada — defina ${cfg.envKey} no .env.`)

    const { url, init } = cfg.requisicao(chave, cfg.modeloPadrao, req)
    let resp: Response
    try {
      resp = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new ErroNegocio('IA_FALHOU', `Falha ao contatar a IA (${rotuloDe(req.motorId)}).`)
    }
    if (!resp.ok) throw new ErroNegocio('IA_FALHOU', `A IA (${rotuloDe(req.motorId)}) respondeu ${resp.status}.`)
    return { texto: cfg.extrairTexto(await resp.json()) }
  }
}
