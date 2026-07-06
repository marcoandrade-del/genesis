import type { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
import { ErroNegocio } from '../errors.js'
import { parseComposicao, type ComposicaoRcl } from './rcl.js'
import { parseClassificacaoFonte, ORDEM_FINALIDADE, type ClassificacaoFonte } from './fonte-classificacao.js'
import { parsePessoal, type ComposicaoPessoal } from './despesa-pessoal.js'
import { IaPreferenciaService } from './ia-preferencia.js'
import { MotorIaClientHttp, type MotorIaClient } from './ia-cliente.js'
import { lerXlsxBase64 } from './rcl-xlsx.js'

/** Formatos aceitos pelo import da bancada (detectados pela extensão no browser). */
export type FormatoImport = 'xlsx' | 'docx' | 'json' | 'texto' | 'pdf'

/** Proposta para os 3 editores da bancada. Cada memorial é null quando não foi
 *  identificado no documento — o cliente só substitui os que vieram. */
export interface PropostaMemoriais {
  rcl: ComposicaoRcl | null
  fonte: ClassificacaoFonte | null
  pessoal: ComposicaoPessoal | null
  origem: 'json' | 'ia'
}

const MAX_CHARS = 60_000

const SYSTEM =
  'Você é um especialista em contabilidade pública brasileira e na LRF (RREO/RGF da STN). ' +
  'A partir de uma memória de cálculo de um Tribunal de Contas, extraia as metodologias em PREFIXOS de código ' +
  '(natureza de receita ou de despesa). Responda SOMENTE com JSON, sem texto ao redor e sem cercas de código.'

function montarPrompt(texto: string): string {
  return (
    'O documento abaixo é a memória de cálculo de um TCE. Identifique QUAIS dos 3 memoriais estão presentes e ' +
    'extraia cada um. Um memorial ausente deve vir como null.\n\n' +
    '1) RCL — as DEDUÇÕES da Receita Corrente Líquida (prefixos de natureza de RECEITA).\n' +
    '2) fonte — classificação de FONTE de recurso → finalidade (prefixos de fonte/receita). Finalidades válidas: ' +
    ORDEM_FINALIDADE.join(', ') +
    '.\n' +
    '3) pessoal — Despesa com Pessoal (DTP): INCLUSÕES menos EXCLUSÕES (prefixos de natureza de DESPESA).\n\n' +
    'Responda APENAS com este JSON EXATO (campos ausentes = null):\n' +
    '{"rcl":{"nome":"<texto>","deducoes":[{"rotulo":"<texto>","prefixos":["<prefixo>"]}]} | null,' +
    '"fonte":{"nome":"<texto>","regras":[{"finalidade":"<FINALIDADE>","prefixos":["<prefixo>"]}]} | null,' +
    '"pessoal":{"nome":"<texto>","inclusoes":[{"rotulo":"<texto>","prefixos":["<prefixo>"]}],"exclusoes":[{"rotulo":"<texto>","prefixos":["<prefixo>"]}]} | null}\n\n' +
    'DOCUMENTO:\n' +
    texto
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

/** Valida os 3 memoriais de um objeto qualquer. Aceita o envelope {rcl,fonte,pessoal}
 *  OU uma composição solta — os parses são discriminados pelo campo-array obrigatório
 *  (deducoes/regras/inclusoes), então uma composição só casa com um dos três. */
function validarTres(obj: unknown): Omit<PropostaMemoriais, 'origem'> | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const rcl = parseComposicao(o.rcl ?? o)
  const fonte = parseClassificacaoFonte(o.fonte ?? o)
  const pessoal = parsePessoal(o.pessoal ?? o)
  if (!rcl && !fonte && !pessoal) return null
  return { rcl, fonte, pessoal }
}

/** Extrai o texto simples de um DOCX (zip com word/document.xml). */
async function extrairTextoDocx(base64: string): Promise<string> {
  const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'))
  const doc = zip.file('word/document.xml')
  if (!doc) throw new ErroNegocio('REQUISICAO_INVALIDA', 'DOCX inválido (sem word/document.xml).')
  const xml = await doc.async('string')
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/?>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Extrai a camada de texto de um PDF (pdfjs). PDF escaneado (imagem, sem OCR)
 *  volta vazio — o chamador acusa "sem conteúdo legível". Import dinâmico: o
 *  pdfjs é pesado e só é pago quando chega PDF de verdade. */
async function extrairTextoPdf(base64: string): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const tarefa = getDocument({ data: new Uint8Array(Buffer.from(base64, 'base64')), useSystemFonts: true })
  const doc = await tarefa.promise
  try {
    const partes: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const pagina = await doc.getPage(p)
      const conteudo = await pagina.getTextContent()
      partes.push(conteudo.items.map((i) => ('str' in i ? i.str : '')).join(' '))
    }
    return partes
      .join('\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  } finally {
    await tarefa.destroy()
  }
}

const MAGIC_PDF_B64 = 'JVBERi' // = base64 de "%PDF-" — PDF renomeado p/ .txt cai aqui

async function extrairTexto(formato: FormatoImport, base64: string): Promise<string> {
  if (formato === 'pdf' || base64.startsWith(MAGIC_PDF_B64)) return extrairTextoPdf(base64)
  if (formato === 'xlsx') return lerXlsxBase64(base64)
  if (formato === 'docx') return extrairTextoDocx(base64)
  return Buffer.from(base64, 'base64').toString('utf8') // json | texto
}

/**
 * Import multi-formato dos memoriais da bancada. Extrai texto do documento
 * (xlsx/docx/pdf/json/texto), tenta ler diretamente como JSON dos nossos formatos
 * (grátis, determinístico — permite reimportar o que a bancada exporta) e, se
 * não for, delega à IA (motor preferido do usuário). A saída é SEMPRE validada
 * pelos parses (reuso) — o que não validar volta null e o cliente ignora.
 */
export class MemoriaisImportIaService {
  private readonly prefs: IaPreferenciaService

  constructor(
    prisma: PrismaClient,
    private readonly ia: MotorIaClient = new MotorIaClientHttp(),
  ) {
    this.prefs = new IaPreferenciaService(prisma)
  }

  async propor(usuarioId: string, formato: FormatoImport, base64: string): Promise<PropostaMemoriais> {
    if (!base64?.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Arquivo vazio.')
    let texto = (await extrairTexto(formato, base64)).trim()
    if (!texto) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Documento sem conteúdo legível.')
    if (texto.length > MAX_CHARS) texto = texto.slice(0, MAX_CHARS) + '\n…(truncado)'

    // 1) JSON já no nosso formato → sem IA (grátis e instantâneo).
    try {
      const direto = validarTres(JSON.parse(texto))
      if (direto) return { ...direto, origem: 'json' }
    } catch {
      /* não é JSON puro — segue para a IA */
    }

    // 2) IA propõe os 3 (1 retry). chamar() fora do try: erro de config/rede propaga direto.
    const { motor } = await this.prefs.ler(usuarioId)
    const prompt = montarPrompt(texto)
    let ultimaFalha = 'nenhum memorial reconhecido'
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const { texto: resp } = await this.ia.chamar({ motorId: motor, system: SYSTEM, user: prompt, maxTokens: 4096 })
      try {
        const validado = validarTres(extrairJson(resp))
        if (validado) return { ...validado, origem: 'ia' }
      } catch (e) {
        ultimaFalha = e instanceof Error ? e.message : 'JSON inválido'
      }
    }
    throw new ErroNegocio(
      'IA_FALHOU',
      `A IA não reconheceu nenhum memorial válido (${ultimaFalha}). Tente outro arquivo ou edite manualmente.`,
    )
  }
}
