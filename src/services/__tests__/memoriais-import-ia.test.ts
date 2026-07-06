import { describe, it, expect, beforeEach, vi } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { MemoriaisImportIaService } from '../memoriais-import-ia.js'
import { ErroNegocio } from '../../errors.js'
import type { MotorIaClient } from '../ia-cliente.js'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

const RCL = { nome: 'TCE-SC', deducoes: [{ rotulo: 'FUNDEB', prefixos: ['1.7.5.1.50'] }] }
const FONTE = { nome: 'Fonte SC', regras: [{ finalidade: 'MDE', prefixos: ['103'] }] }
const PESSOAL = { nome: 'Pessoal SC', inclusoes: [{ rotulo: 'Ativos', prefixos: ['3.1'] }], exclusoes: [] }

describe('MemoriaisImportIaService.propor', () => {
  let prisma: PrismaMock
  let ia: { chamar: ReturnType<typeof vi.fn> }
  let svc: MemoriaisImportIaService

  beforeEach(() => {
    prisma = criarPrismaMock()
    prisma.usuario.findUnique.mockResolvedValue({ iaEngine: 'profunda', iaMotor: 'claude' })
    ia = { chamar: vi.fn() }
    svc = new MemoriaisImportIaService(prisma as never, ia as unknown as MotorIaClient)
  })

  it('JSON no nosso formato (envelope) → não chama a IA (origem json)', async () => {
    const r = await svc.propor('u1', 'json', b64(JSON.stringify({ rcl: RCL, fonte: FONTE, pessoal: PESSOAL })))
    expect(r.origem).toBe('json')
    expect(r.rcl?.deducoes[0]!.prefixos).toEqual(['1.7.5.1.50'])
    expect(r.fonte?.regras[0]!.finalidade).toBe('MDE')
    expect(r.pessoal?.inclusoes[0]!.prefixos).toEqual(['3.1'])
    expect(ia.chamar).not.toHaveBeenCalled()
  })

  it('JSON de uma composição solta → casa só com o memorial certo (discriminado pelo campo-array)', async () => {
    const r = await svc.propor('u1', 'json', b64(JSON.stringify(RCL)))
    expect(r.origem).toBe('json')
    expect(r.rcl?.nome).toBe('TCE-SC')
    expect(r.fonte).toBeNull()
    expect(r.pessoal).toBeNull()
    expect(ia.chamar).not.toHaveBeenCalled()
  })

  it('texto livre → IA propõe os 3 (envelope, tolera cercas ```json)', async () => {
    ia.chamar.mockResolvedValue({ texto: '```json\n' + JSON.stringify({ rcl: RCL, fonte: FONTE, pessoal: PESSOAL }) + '\n```' })
    const r = await svc.propor('u1', 'texto', b64('memória de cálculo do TCE...'))
    expect(r.origem).toBe('ia')
    expect(r.rcl?.nome).toBe('TCE-SC')
    expect(r.pessoal?.nome).toBe('Pessoal SC')
    expect(ia.chamar).toHaveBeenCalledWith(expect.objectContaining({ motorId: 'claude' }))
  })

  it('IA identifica só um memorial → os outros voltam null', async () => {
    ia.chamar.mockResolvedValue({ texto: JSON.stringify({ rcl: null, fonte: null, pessoal: PESSOAL }) })
    const r = await svc.propor('u1', 'texto', b64('só a memória de pessoal'))
    expect(r.pessoal?.nome).toBe('Pessoal SC')
    expect(r.rcl).toBeNull()
    expect(r.fonte).toBeNull()
  })

  it('IA sem nenhum memorial válido nas 2 tentativas → IA_FALHOU (com retry)', async () => {
    ia.chamar.mockResolvedValue({ texto: '{"rcl":null,"fonte":null,"pessoal":null}' })
    await expect(svc.propor('u1', 'texto', b64('texto qualquer'))).rejects.toMatchObject({ code: 'IA_FALHOU' })
    expect(ia.chamar).toHaveBeenCalledTimes(2)
  })

  it('arquivo vazio → REQUISICAO_INVALIDA (não chama a IA)', async () => {
    await expect(svc.propor('u1', 'texto', '   ')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(ia.chamar).not.toHaveBeenCalled()
  })

  it('erro do motor (ex.: sem chave) propaga sem retry', async () => {
    ia.chamar.mockRejectedValue(new ErroNegocio('IA_NAO_CONFIGURADA', 'sem chave'))
    await expect(svc.propor('u1', 'texto', b64('x'))).rejects.toMatchObject({ code: 'IA_NAO_CONFIGURADA' })
    expect(ia.chamar).toHaveBeenCalledTimes(1)
  })

  it('xlsx → extrai a grade e manda o conteúdo à IA', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Memória')
    ws.addRow(['Dedução FUNDEB', '1.7.5.1.50'])
    const base64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')
    ia.chamar.mockResolvedValue({ texto: JSON.stringify({ rcl: RCL, fonte: null, pessoal: null }) })
    const r = await svc.propor('u1', 'xlsx', base64)
    expect(r.rcl?.nome).toBe('TCE-SC')
    expect(ia.chamar.mock.calls[0][0].user).toContain('1.7.5.1.50')
  })

  it('docx → extrai o texto do word/document.xml e manda à IA', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Inclusão Pessoal 3.1</w:t></w:r></w:p></w:body></w:document>')
    const base64 = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })).toString('base64')
    ia.chamar.mockResolvedValue({ texto: JSON.stringify({ rcl: null, fonte: null, pessoal: PESSOAL }) })
    const r = await svc.propor('u1', 'docx', base64)
    expect(r.pessoal?.nome).toBe('Pessoal SC')
    expect(ia.chamar.mock.calls[0][0].user).toContain('Inclusão Pessoal 3.1')
  })

  /** PDF mínimo válido (1 página, Helvetica) com o texto dado — offsets de xref calculados. */
  function pdfMinimo(texto: string): string {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      '', // 4: stream (montado abaixo)
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    const stream = `BT /F1 12 Tf 72 720 Td (${texto}) Tj ET`
    objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    let corpo = '%PDF-1.4\n'
    const offsets: number[] = []
    objs.forEach((o, i) => {
      offsets.push(corpo.length)
      corpo += `${i + 1} 0 obj\n${o}\nendobj\n`
    })
    const xref = corpo.length
    corpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    for (const off of offsets) corpo += `${String(off).padStart(10, '0')} 00000 n \n`
    corpo += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
    return Buffer.from(corpo, 'latin1').toString('base64')
  }

  it('pdf → extrai a camada de texto e manda à IA (doc só com fonte → só fonte volta)', async () => {
    ia.chamar.mockResolvedValue({ texto: JSON.stringify({ rcl: null, fonte: FONTE, pessoal: null }) })
    const r = await svc.propor('u1', 'pdf', pdfMinimo('FONTES E DESTINACAO DE RECURSOS 550 MDE'))
    expect(r.fonte?.regras[0]!.finalidade).toBe('MDE')
    expect(r.rcl).toBeNull()
    expect(r.pessoal).toBeNull()
    expect(ia.chamar.mock.calls[0][0].user).toContain('FONTES E DESTINACAO DE RECURSOS 550 MDE')
  })

  it('PDF disfarçado de texto (magic %PDF) → extrai igual, não manda bytes crus à IA', async () => {
    ia.chamar.mockResolvedValue({ texto: JSON.stringify({ rcl: null, fonte: FONTE, pessoal: null }) })
    const r = await svc.propor('u1', 'texto', pdfMinimo('Classificacao de fonte 540 FUNDEB'))
    expect(r.fonte?.nome).toBe('Fonte SC')
    const prompt = ia.chamar.mock.calls[0][0].user as string
    expect(prompt).toContain('Classificacao de fonte 540 FUNDEB')
    expect(prompt).not.toContain('%PDF')
  })

  it('PDF sem camada de texto → erro claro de documento sem conteúdo legível', async () => {
    await expect(svc.propor('u1', 'pdf', pdfMinimo(''))).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(ia.chamar).not.toHaveBeenCalled()
  })
})
