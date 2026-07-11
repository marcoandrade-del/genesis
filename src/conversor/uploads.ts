import { mkdirSync, createWriteStream } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { pipeline } from 'node:stream/promises'

/**
 * Armazenamento dos arquivos do conversor (exports do portal do fabricante).
 * Ficam em `data/conversor/<ibge>/` (fora do git — `/data/` é .gitignored). O
 * caminho absoluto salvo volta para os `params` da config, e é o que o conector lê.
 */
const BASE = resolve(process.cwd(), 'data', 'conversor')

/** Nome de arquivo determinístico por (escopo, id, chave) — re-upload sobrescreve. */
export function nomeArquivo(escopo: 'municipio' | 'entidade', id: string, chave: string, original: string): string {
  const ext = extname(original).toLowerCase()
  const prefixo = escopo === 'municipio' ? 'mun' : `ent-${id}`
  return `${prefixo}-${chave}${ext}`
}

/** Salva o stream do upload em `data/conversor/<ibge>/<nome>` e devolve o caminho absoluto. */
export async function salvarUpload(ibge: string, nome: string, stream: NodeJS.ReadableStream): Promise<string> {
  const dir = join(BASE, ibge)
  mkdirSync(dir, { recursive: true })
  const destino = join(dir, nome)
  await pipeline(stream, createWriteStream(destino))
  return destino
}
