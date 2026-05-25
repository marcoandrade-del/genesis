import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  ImportadorPlanoContasService,
  parseCSV,
  parseCSVLine,
  parseBoolean,
  validar,
} from '../importador-plano-contas.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PLANO = { id: 'p1', descricao: 'PCASP 2026', ano: 2026, modeloContabilId: 'm1' }

let prisma: PrismaMock
let service: ImportadorPlanoContasService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ImportadorPlanoContasService(prisma as never)
})

const CSV_BASE = `codigo,descricao,codigoPai,admiteMovimento
1,Ativo,,false
1.1,Ativo Circulante,1,false
1.1.1,Caixa Geral,1.1,true`

describe('parseCSVLine', () => {
  it('divide por vírgula simples', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('respeita vírgulas dentro de aspas', () => {
    expect(parseCSVLine('"a,b",c')).toEqual(['a,b', 'c'])
  })

  it('escapa aspas dobradas dentro de campo entre aspas', () => {
    expect(parseCSVLine('"diz ""olá""",x')).toEqual(['diz "olá"', 'x'])
  })

  it('campo vazio', () => {
    expect(parseCSVLine('a,,c')).toEqual(['a', '', 'c'])
  })
})

describe('parseBoolean', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['s', true],
    ['S', true],
    ['sim', true],
    ['1', true],
    ['false', false],
    ['n', false],
    ['nao', false],
    ['0', false],
    ['', false],
    [undefined, false],
    ['qualquer-coisa', false],
  ])('parseBoolean(%j) → %s', (entrada, esperado) => {
    expect(parseBoolean(entrada as string | undefined)).toBe(esperado)
  })
})

describe('parseCSV', () => {
  it('parseia o caminho feliz', () => {
    const r = parseCSV(CSV_BASE)
    expect(r).toHaveLength(3)
    expect(r[0]).toEqual({ codigo: '1', descricao: 'Ativo', codigoPai: null, admiteMovimento: false })
    expect(r[2]).toEqual({ codigo: '1.1.1', descricao: 'Caixa Geral', codigoPai: '1.1', admiteMovimento: true })
  })

  it('aceita CRLF', () => {
    const csv = CSV_BASE.replace(/\n/g, '\r\n')
    expect(parseCSV(csv)).toHaveLength(3)
  })

  it('ignora linhas em branco', () => {
    const csv = CSV_BASE + '\n\n\n'
    expect(parseCSV(csv)).toHaveLength(3)
  })

  it('remove BOM UTF-8 do Excel', () => {
    const csv = '﻿' + CSV_BASE
    expect(parseCSV(csv)).toHaveLength(3)
  })

  it('lança REQUISICAO_INVALIDA com CSV totalmente vazio', () => {
    expect(() => parseCSV('   \n\n')).toThrow(/CSV vazio/)
  })

  it('lança REQUISICAO_INVALIDA quando falta coluna obrigatória', () => {
    expect(() => parseCSV('codigo,descricao\n1,Ativo')).toThrow(/Coluna obrigatória ausente/)
  })

  it('lança REQUISICAO_INVALIDA quando código vazio', () => {
    const csv = `codigo,descricao,codigoPai,admiteMovimento\n,Ativo,,false`
    expect(() => parseCSV(csv)).toThrow(/Linha 2: código vazio/)
  })

  it('lança REQUISICAO_INVALIDA quando descrição vazia', () => {
    const csv = `codigo,descricao,codigoPai,admiteMovimento\n1,,,false`
    expect(() => parseCSV(csv)).toThrow(/Linha 2: descrição vazia/)
  })

  it('trata linha com menos colunas que o header (campos faltantes viram vazios)', () => {
    // Linha tem só "1" — descricao/codigoPai/admiteMovimento são undefined em partes[].
    const csv = `codigo,descricao,codigoPai,admiteMovimento\n1`
    expect(() => parseCSV(csv)).toThrow(/Linha 2: descrição vazia/)
  })

  it('aceita header em ordem diferente; linha curta faz codigo cair no fallback', () => {
    // idx.codigo=1; partes=['Ativo'] → partes[1] é undefined.
    const csv = `descricao,codigo,codigoPai,admiteMovimento\nAtivo`
    expect(() => parseCSV(csv)).toThrow(/código vazio/)
  })

  it('aceita CSV sem colunas opcionais trailing — codigoPai e admiteMovimento implícitos', () => {
    const csv = `codigo,descricao,codigoPai,admiteMovimento\n1,Ativo`
    const r = parseCSV(csv)
    expect(r).toEqual([{ codigo: '1', descricao: 'Ativo', codigoPai: null, admiteMovimento: false }])
  })
})

describe('validar', () => {
  it('aceita hierarquia válida e retorna níveis corretos', () => {
    const linhas = parseCSV(CSV_BASE)
    const niveis = validar(linhas)
    expect(niveis.get('1')).toBe(1)
    expect(niveis.get('1.1')).toBe(2)
    expect(niveis.get('1.1.1')).toBe(3)
  })

  it('lança CONFLITO em código duplicado', () => {
    const csv = `codigo,descricao,codigoPai,admiteMovimento
1,A,,false
1,B,,false`
    expect(() => validar(parseCSV(csv))).toThrow(/Código duplicado/)
  })

  it('lança REQUISICAO_INVALIDA quando codigoPai não existe no arquivo', () => {
    const csv = `codigo,descricao,codigoPai,admiteMovimento
1.1,Filho,9,false`
    expect(() => validar(parseCSV(csv))).toThrow(/codigoPai "9" inexistente/)
  })

  it('detecta ciclo (A→B→A)', () => {
    const linhas = [
      { codigo: 'A', descricao: 'A', codigoPai: 'B', admiteMovimento: false },
      { codigo: 'B', descricao: 'B', codigoPai: 'A', admiteMovimento: false },
    ]
    expect(() => validar(linhas)).toThrow(/Ciclo na hierarquia/)
  })

  it('lança CONFLITO quando profundidade > 7', () => {
    // 8 níveis: 1 → 1.1 → ... → 1.1.1.1.1.1.1.1
    const linhas: { codigo: string; descricao: string; codigoPai: string | null; admiteMovimento: boolean }[] = []
    let pai: string | null = null
    for (let i = 1; i <= 8; i++) {
      const codigo = Array(i).fill('1').join('.')
      linhas.push({ codigo, descricao: `N${i}`, codigoPai: pai, admiteMovimento: false })
      pai = codigo
    }
    expect(() => validar(linhas)).toThrow(/profundidade máxima de 7/)
  })

  it('aceita exatamente 7 níveis', () => {
    const linhas: { codigo: string; descricao: string; codigoPai: string | null; admiteMovimento: boolean }[] = []
    let pai: string | null = null
    for (let i = 1; i <= 7; i++) {
      const codigo = Array(i).fill('1').join('.')
      linhas.push({ codigo, descricao: `N${i}`, codigoPai: pai, admiteMovimento: false })
      pai = codigo
    }
    const niveis = validar(linhas)
    expect(niveis.get('1.1.1.1.1.1.1')).toBe(7)
  })

  it('lança CONFLITO quando conta admite movimento mas tem filho', () => {
    const csv = `codigo,descricao,codigoPai,admiteMovimento
1,Pai,,true
1.1,Filho,1,false`
    expect(() => validar(parseCSV(csv))).toThrow(/admite movimento mas tem filhos/)
  })
})

describe('ImportadorPlanoContasService.importar', () => {
  it('importa com sucesso (caminho feliz)', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.createMany.mockResolvedValue({ count: 3 })

    const r = await service.importar('p1', CSV_BASE)

    expect(r).toEqual({ criadas: 3 })
    expect(prisma.conta.createMany).toHaveBeenCalledOnce()

    const dados = prisma.conta.createMany.mock.calls[0][0].data
    expect(dados).toHaveLength(3)
    expect(dados[0]).toMatchObject({ codigo: '1', nivel: 1, parentId: null, planoId: 'p1' })
    // parentId do filho aponta para o id (UUID) gerado para o pai
    expect(dados[1].parentId).toBe(dados[0].id)
    expect(dados[2].parentId).toBe(dados[1].id)
    expect(dados[2]).toMatchObject({ admiteMovimento: true, nivel: 3 })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando plano não existe', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(null)
    await expect(service.importar('xx', CSV_BASE)).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.conta.createMany).not.toHaveBeenCalled()
  })

  it('lança REQUISICAO_INVALIDA quando CSV só tem header', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    await expect(service.importar('p1', 'codigo,descricao,codigoPai,admiteMovimento'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('propaga erro de validação (código duplicado → CONFLITO)', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    const csv = `codigo,descricao,codigoPai,admiteMovimento
1,A,,false
1,B,,false`
    await expect(service.importar('p1', csv)).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.conta.createMany).not.toHaveBeenCalled()
  })

  it('lança CONFLITO quando createMany retorna P2002 (código já no plano)', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.createMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' }),
    )
    await expect(service.importar('p1', CSV_BASE)).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga outros erros do banco', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    prisma.conta.createMany.mockRejectedValue(new Error('conexão caiu'))
    await expect(service.importar('p1', CSV_BASE)).rejects.toThrow('conexão caiu')
  })

  it('propaga Prisma error com código não tratado', async () => {
    prisma.planoDeContas.findUnique.mockResolvedValue(PLANO)
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.conta.createMany.mockRejectedValue(erro)
    await expect(service.importar('p1', CSV_BASE)).rejects.toBe(erro)
  })
})
