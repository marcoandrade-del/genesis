import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ConciliacaoBancariaService } from '../conciliacao-bancaria.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const D = (v: string) => new Prisma.Decimal(v)
let prisma: PrismaMock
let svc: ConciliacaoBancariaService
const CONTA = { id: 'cb1', entidadeId: 'ent1', bancoCodigo: '104', agencia: '0394', numero: '123', numeroDv: null, agenciaDv: null, descricao: 'Mov', fonteCodigo: '1000', ativa: true }

beforeEach(() => {
  prisma = criarPrismaMock()
  svc = new ConciliacaoBancariaService(prisma as never)
  prisma.contaBancaria.findUnique.mockResolvedValue(CONTA)
})

describe('registrarManual', () => {
  it('cria o crédito após validar a conta', async () => {
    prisma.movimentoBancario.create.mockResolvedValue({ id: 'm1' })
    await svc.registrarManual('cb1', 'ent1', { data: '2026-06-10', valor: '100', historico: 'x' })
    const data = prisma.movimentoBancario.create.mock.calls[0][0].data
    expect(data).toMatchObject({ contaBancariaId: 'cb1', sentido: 'CREDITO', origemImport: 'MANUAL' })
    expect(data.valor.toString()).toBe('100')
  })

  it('rejeita conta de outra entidade, valor não-positivo e data inválida', async () => {
    prisma.contaBancaria.findUnique.mockResolvedValue({ ...CONTA, entidadeId: 'OUTRA' })
    await expect(svc.registrarManual('cb1', 'ent1', { data: '2026-06-10', valor: '100' })).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    prisma.contaBancaria.findUnique.mockResolvedValue(CONTA)
    await expect(svc.registrarManual('cb1', 'ent1', { data: '2026-06-10', valor: '0' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(svc.registrarManual('cb1', 'ent1', { data: 'xx', valor: '5' })).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
  })
})

describe('importar', () => {
  it('parseia o CSV e cria os movimentos num lote', async () => {
    await svc.importar('cb1', 'ent1', 'CSV', '01/06/2026;100,00;FPM\n02/06/2026;200,00;ISS')
    const arg = prisma.movimentoBancario.createMany.mock.calls[0][0].data
    expect(arg).toHaveLength(2)
    expect(arg[0]).toMatchObject({ contaBancariaId: 'cb1', sentido: 'CREDITO', origemImport: 'CSV' })
    expect(arg[0].loteImport).toBe(arg[1].loteImport) // mesmo lote
  })

  it('CNAB ainda não disponível', async () => {
    await expect(svc.importar('cb1', 'ent1', 'CNAB', 'x')).rejects.toThrow(/CNAB/)
  })
})

describe('painel', () => {
  beforeEach(() => {
    prisma.movimentoBancario.findMany.mockResolvedValue([
      { id: 'm1', data: new Date('2026-06-01'), valor: D('100'), historico: 'a', origemImport: 'OFX', arrecadacaoId: 'a1', arrecadacao: { id: 'a1', data: new Date('2026-06-01'), valor: D('100'), previsao: { contaReceita: { codigo: '1.7', descricao: 'FPM' }, fonteRecurso: { codigo: '1000' } } } },
      { id: 'm2', data: new Date('2026-06-05'), valor: D('50'), historico: 'b', origemImport: 'OFX', arrecadacaoId: null, arrecadacao: null },
    ])
    prisma.arrecadacao.findMany.mockResolvedValue([
      { id: 'a1', data: new Date('2026-06-01'), valor: D('100'), previsao: { contaReceita: { codigo: '1.7', descricao: 'FPM' }, fonteRecurso: { codigo: '1000' } }, movimentoBancario: { id: 'm1' } },
      { id: 'a2', data: new Date('2026-06-06'), valor: D('70'), previsao: { contaReceita: { codigo: '1.9', descricao: 'Multa' }, fonteRecurso: { codigo: '1000' } }, movimentoBancario: null },
    ])
  })

  it('separa conciliados / extrato pendente / arrecadações pendentes e soma os totais', async () => {
    const p = await svc.painel('cb1', 'ent1', 2026)
    expect(p.conciliados.map((m) => m.id)).toEqual(['m1'])
    expect(p.extratoPendente.map((m) => m.id)).toEqual(['m2'])
    expect(p.arrecadacoesPendentes.map((a) => a.id)).toEqual(['a2'])
    expect(p.totais.extrato).toBe(150) // 100 + 50
    expect(p.totais.arrecadado).toBe(170) // 100 + 70
    expect(p.totais.conciliado).toBe(100)
    expect(p.totais.diferenca).toBe(-20)
  })
})

describe('sugerir', () => {
  it('casa crédito pendente com arrecadação pendente de mesmo valor e data próxima', async () => {
    prisma.movimentoBancario.findMany.mockResolvedValue([
      { id: 'm2', data: new Date('2026-06-06'), valor: D('70'), historico: 'b', origemImport: 'OFX', arrecadacaoId: null, arrecadacao: null },
    ])
    prisma.arrecadacao.findMany.mockResolvedValue([
      { id: 'a2', data: new Date('2026-06-07'), valor: D('70'), previsao: { contaReceita: { codigo: '1.9', descricao: 'Multa' }, fonteRecurso: { codigo: '1000' } }, movimentoBancario: null },
    ])
    const n = await svc.sugerir('cb1', 'ent1', 2026)
    expect(n).toBe(1)
    expect(prisma.movimentoBancario.update).toHaveBeenCalledWith({ where: { id: 'm2' }, data: { arrecadacaoId: 'a2' } })
  })

  it('não casa quando há ambiguidade (duas candidatas)', async () => {
    prisma.movimentoBancario.findMany.mockResolvedValue([
      { id: 'm2', data: new Date('2026-06-06'), valor: D('70'), historico: 'b', origemImport: 'OFX', arrecadacaoId: null, arrecadacao: null },
    ])
    prisma.arrecadacao.findMany.mockResolvedValue([
      { id: 'a2', data: new Date('2026-06-06'), valor: D('70'), previsao: { contaReceita: { codigo: '1.9', descricao: 'x' }, fonteRecurso: { codigo: '1000' } }, movimentoBancario: null },
      { id: 'a3', data: new Date('2026-06-06'), valor: D('70'), previsao: { contaReceita: { codigo: '1.9', descricao: 'y' }, fonteRecurso: { codigo: '1000' } }, movimentoBancario: null },
    ])
    expect(await svc.sugerir('cb1', 'ent1', 2026)).toBe(0)
    expect(prisma.movimentoBancario.update).not.toHaveBeenCalled()
  })
})

describe('conciliar / desconciliar', () => {
  it('concilia crédito pendente com arrecadação da mesma conta', async () => {
    prisma.movimentoBancario.findUnique.mockResolvedValue({ id: 'm2', sentido: 'CREDITO', arrecadacaoId: null, contaBancariaId: 'cb1', contaBancaria: { entidadeId: 'ent1' } })
    prisma.arrecadacao.findUnique.mockResolvedValue({ id: 'a2', tipo: 'ARRECADACAO', contaBancariaId: 'cb1', movimentoBancario: null })
    await svc.conciliar('m2', 'a2', 'ent1')
    expect(prisma.movimentoBancario.update).toHaveBeenCalledWith({ where: { id: 'm2' }, data: { arrecadacaoId: 'a2' } })
  })

  it('rejeita conciliação com arrecadação de outra conta ou já conciliada', async () => {
    prisma.movimentoBancario.findUnique.mockResolvedValue({ id: 'm2', sentido: 'CREDITO', arrecadacaoId: null, contaBancariaId: 'cb1', contaBancaria: { entidadeId: 'ent1' } })
    prisma.arrecadacao.findUnique.mockResolvedValue({ id: 'a2', tipo: 'ARRECADACAO', contaBancariaId: 'OUTRA', movimentoBancario: null })
    await expect(svc.conciliar('m2', 'a2', 'ent1')).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })

    prisma.arrecadacao.findUnique.mockResolvedValue({ id: 'a2', tipo: 'ARRECADACAO', contaBancariaId: 'cb1', movimentoBancario: { id: 'outro' } })
    await expect(svc.conciliar('m2', 'a2', 'ent1')).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('desconciliar limpa o vínculo', async () => {
    prisma.movimentoBancario.findUnique.mockResolvedValue({ id: 'm1', contaBancariaId: 'cb1', contaBancaria: { entidadeId: 'ent1' } })
    await svc.desconciliar('m1', 'ent1')
    expect(prisma.movimentoBancario.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { arrecadacaoId: null } })
  })
})
