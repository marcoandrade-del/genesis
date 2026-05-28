import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ImportadorPlanoReceitaService } from '../importador-plano-receita.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PLANO = { id: 'pr1', descricao: 'Receita 2026', ano: 2026, modeloContabilId: 'm1' }

const CSV_BASE = `codigo,descricao,codigoPai,admiteMovimento
1,Receitas Correntes,,false
1.1,Impostos,1,false
1.1.1,IPTU,1.1,true`

let prisma: PrismaMock
let service: ImportadorPlanoReceitaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ImportadorPlanoReceitaService(prisma as never)
})

describe('ImportadorPlanoReceitaService.importar', () => {
  it('importa com sucesso (caminho feliz)', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.createMany.mockResolvedValue({ count: 3 })

    const r = await service.importar('pr1', CSV_BASE)

    expect(r).toEqual({ criadas: 3 })
    const dados = prisma.contaReceita.createMany.mock.calls[0][0].data
    expect(dados).toHaveLength(3)
    expect(dados[0]).toMatchObject({ codigo: '1', nivel: 1, parentId: null, planoId: 'pr1' })
    expect(dados[1].parentId).toBe(dados[0].id)
    expect(dados[2]).toMatchObject({ admiteMovimento: true, nivel: 3 })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando plano não existe', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(null)
    await expect(service.importar('xx', CSV_BASE)).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.contaReceita.createMany).not.toHaveBeenCalled()
  })

  it('lança REQUISICAO_INVALIDA quando CSV só tem header', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    await expect(service.importar('pr1', 'codigo,descricao,codigoPai,admiteMovimento'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('propaga erro de validação (código duplicado → CONFLITO)', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    const csv = `codigo,descricao,codigoPai,admiteMovimento\n1,A,,false\n1,B,,false`
    await expect(service.importar('pr1', csv)).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaReceita.createMany).not.toHaveBeenCalled()
  })

  it('aceita até NIVEL_MAX_RECEITA (12) e barra acima', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    const linha = (n: number) => Array(n).fill('1').join('.')
    let csv = 'codigo,descricao,codigoPai,admiteMovimento\n'
    for (let i = 1; i <= 13; i++) {
      csv += `${linha(i)},N${i},${i === 1 ? '' : linha(i - 1)},false\n`
    }
    await expect(service.importar('pr1', csv)).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando createMany retorna P2002', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.createMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' }),
    )
    await expect(service.importar('pr1', CSV_BASE)).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga outros erros do banco', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    prisma.contaReceita.createMany.mockRejectedValue(new Error('conexão caiu'))
    await expect(service.importar('pr1', CSV_BASE)).rejects.toThrow('conexão caiu')
  })

  it('propaga Prisma error com código não tratado', async () => {
    prisma.planoContasReceita.findUnique.mockResolvedValue(PLANO)
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.contaReceita.createMany.mockRejectedValue(erro)
    await expect(service.importar('pr1', CSV_BASE)).rejects.toBe(erro)
  })
})
