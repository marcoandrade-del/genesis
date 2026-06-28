import ExcelJS from 'exceljs'

export interface OpcoesLeituraXlsx {
  maxLinhas?: number // por aba
  maxColunas?: number
  maxChars?: number // teto do texto final (pro prompt)
}

/**
 * Lê um xlsx (em base64, vindo do FileReader do browser) e devolve uma GRADE DE
 * TEXTO simples (abas → linhas tab-separadas) pra mandar à IA. Trunca linhas,
 * colunas e tamanho total pra não estourar o prompt/custo. Reusa o `exceljs` que
 * já é dependência do projeto (hoje só na exportação — `relatorio-export.ts`).
 */
export async function lerXlsxBase64(base64: string, opts: OpcoesLeituraXlsx = {}): Promise<string> {
  const maxLinhas = opts.maxLinhas ?? 200
  const maxColunas = opts.maxColunas ?? 30
  const maxChars = opts.maxChars ?? 60_000

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(base64, 'base64'))

  const partes: string[] = []
  wb.eachSheet((ws) => {
    const linhas: string[] = []
    let n = 0
    ws.eachRow((row) => {
      if (n >= maxLinhas) return
      n++
      const celulas: string[] = []
      for (let c = 1; c <= maxColunas; c++) celulas.push(String(row.getCell(c).text ?? '').trim())
      while (celulas.length && celulas[celulas.length - 1] === '') celulas.pop()
      linhas.push(celulas.join('\t'))
    })
    partes.push(`# Aba: ${ws.name}\n${linhas.join('\n')}`)
  })

  let texto = partes.join('\n\n').trim()
  if (texto.length > maxChars) texto = texto.slice(0, maxChars) + '\n…(truncado)'
  return texto
}
