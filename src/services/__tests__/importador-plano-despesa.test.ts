import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ImportadorPlanoDespesaService } from '../importador-plano-despesa.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const PLANO = { id: 'pd1', descricao: 'Despesa 2026', ano: 2026, modeloContabilId: 'm1' }

const CSV_BASE = `codigo,descricao,codigoPai,admiteMovimento
3,Despesas Correntes,,false
3.1,Pessoal e Encargos,3,false
3.1.90,Aplicações Diretas,3.1,true`

let prisma: PrismaMock
let service: ImportadorPlanoDespesaService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new ImportadorPlanoDespesaService(prisma as never)
})

describe('ImportadorPlanoDespesaService.importar', () => {
  it('importa com sucesso (caminho feliz)', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.createMany.mockResolvedValue({ count: 3 })

    const r = await service.importar('pd1', CSV_BASE)

    expect(r).toEqual({ criadas: 3 })
    const dados = prisma.contaDespesa.createMany.mock.calls[0][0].data
    expect(dados).toHaveLength(3)
    expect(dados[0]).toMatchObject({ codigo: '3', nivel: 1, parentId: null, planoId: 'pd1' })
    expect(dados[1].parentId).toBe(dados[0].id)
    expect(dados[2]).toMatchObject({ admiteMovimento: true, nivel: 3 })
  })

  it('lança RECURSO_NAO_ENCONTRADO quando plano não existe', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(null)
    await expect(service.importar('xx', CSV_BASE)).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    expect(prisma.contaDespesa.createMany).not.toHaveBeenCalled()
  })

  it('lança REQUISICAO_INVALIDA quando CSV só tem header', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    await expect(service.importar('pd1', 'codigo,descricao,codigoPai,admiteMovimento'))
      .rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })

  it('propaga erro de validação (código duplicado → CONFLITO)', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    const csv = `codigo,descricao,codigoPai,admiteMovimento\n3,A,,false\n3,B,,false`
    await expect(service.importar('pd1', csv)).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaDespesa.createMany).not.toHaveBeenCalled()
  })

  it('barra profundidade acima de NIVEL_MAX_DESPESA (10)', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    const linha = (n: number) => Array(n).fill('3').join('.')
    let csv = 'codigo,descricao,codigoPai,admiteMovimento\n'
    for (let i = 1; i <= 11; i++) {
      csv += `${linha(i)},N${i},${i === 1 ? '' : linha(i - 1)},false\n`
    }
    await expect(service.importar('pd1', csv)).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('lança CONFLITO quando createMany retorna P2002', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.createMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7.0.0' }),
    )
    await expect(service.importar('pd1', CSV_BASE)).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('propaga outros erros do banco', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    prisma.contaDespesa.createMany.mockRejectedValue(new Error('conexão caiu'))
    await expect(service.importar('pd1', CSV_BASE)).rejects.toThrow('conexão caiu')
  })

  it('propaga Prisma error com código não tratado', async () => {
    prisma.planoContasDespesa.findUnique.mockResolvedValue(PLANO)
    const erro = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '7.0.0' })
    prisma.contaDespesa.createMany.mockRejectedValue(erro)
    await expect(service.importar('pd1', CSV_BASE)).rejects.toBe(erro)
  })
})
