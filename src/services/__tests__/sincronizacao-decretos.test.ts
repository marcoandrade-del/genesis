import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { SincronizacaoDecretosService } from '../sincronizacao-decretos.js'

const DESPESA = '02.010.04.122.0002.2.001.3.3.90.30.00.00'
const dotBanco = (autorizado: string) => ({
  id: 'd1',
  valorAutorizado: autorizado,
  valorEmpenhado: '0',
  valorReservado: '0',
  unidadeOrcamentaria: { codigo: '02.010' },
  funcao: { codigo: '04' },
  subfuncao: { codigo: '122' },
  programa: { codigo: '0002' },
  acao: { codigo: '2001' },
  contaDespesa: { codigo: '3.3.90.30.00.00' },
  fonteRecurso: { codigo: '1000' },
})

function stubPortal(itens: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: itens }) }) as Response))
}

describe('SincronizacaoDecretosService', () => {
  let prisma: PrismaMock
  let svc: SincronizacaoDecretosService

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SincronizacaoDecretosService(prisma as never)
    // findUnique atende o sync (entidadeId_ano) e o CreditosAdicionaisService.criar (id)
    prisma.orcamento.findUnique.mockResolvedValue({ id: 'o1', status: 'EM_EXECUCAO' })
    prisma.creditoAdicional.findMany.mockResolvedValue([])
    prisma.dotacaoDespesa.findMany.mockResolvedValue([dotBanco('900')])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('em dia (todos lançados, banco = portal) → OK sem gravar', async () => {
    prisma.creditoAdicional.findMany.mockResolvedValue([{ numero: '1/2026' }])
    stubPortal([{ despesa: DESPESA, valorInicial: 100, valor: 900, saldoAtualizado: 900, decreto: '1/2026', natureza: 'Suplementar', fonteRecurso: 1000, sequencia: 1 }])
    const r = await svc.sincronizar('e1', 2026)
    expect(r.status).toBe('OK')
    expect(r.mensagem).toContain('em dia')
    expect(prisma.creditoAdicional.create).not.toHaveBeenCalled()
    expect(prisma.sincronizacaoPortal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'DECRETOS', status: 'OK' }) }),
    )
  })

  it('decreto pendente com equação exata → lança e materializa autorizado', async () => {
    // banco 900 → portal 1000: decreto 2/2026 reforça 100 (std fecha)
    stubPortal([{ despesa: DESPESA, valorInicial: 900, valor: 100, saldoAtualizado: 1000, decreto: '2/2026', natureza: 'Suplementar', fonteRecurso: 1000, sequencia: 1 }])
    prisma.dotacaoDespesa.findMany
      .mockResolvedValueOnce([dotBanco('900')]) // chaves do sync
      .mockResolvedValueOnce([dotBanco('900')]) // validação do criar
      .mockResolvedValueOnce([dotBanco('1000')]) // verificação final
    prisma.creditoAdicional.create.mockResolvedValue({ id: 'c1' })
    const r = await svc.sincronizar('e1', 2026)
    expect(r.status).toBe('OK')
    expect(r.mensagem).toContain('1 decreto(s) lançado(s)')
    expect(prisma.creditoAdicional.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ numero: '2/2026' }) }),
    )
    expect(prisma.dotacaoDespesa.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'd1' }, data: { valorAutorizado: { increment: expect.anything() } } }),
    )
  })

  it('par ambíguo sem combinação exata → DIVERGENTE e nada gravado', async () => {
    // banco 0 → portal 1000, opções ±300/±800: não fecha
    prisma.dotacaoDespesa.findMany.mockResolvedValue([dotBanco('0')])
    stubPortal([{ despesa: DESPESA, valorInicial: 800, valor: 300, saldoAtualizado: 1000, decreto: '2/2026', natureza: 'Suplementar', fonteRecurso: 1000, sequencia: 1 }])
    const r = await svc.sincronizar('e1', 2026)
    expect(r.status).toBe('DIVERGENTE')
    expect(r.mensagem).toContain('conciliação')
    expect(prisma.creditoAdicional.create).not.toHaveBeenCalled()
  })

  it('dotação sem pendência numerada com banco ≠ portal (S/N novo ou drift) → DIVERGENTE', async () => {
    prisma.creditoAdicional.findMany.mockResolvedValue([{ numero: '1/2026' }])
    stubPortal([
      { despesa: DESPESA, valorInicial: 100, valor: 900, saldoAtualizado: 1000, decreto: '1/2026', natureza: 'Suplementar', fonteRecurso: 1000, sequencia: 1 },
      { despesa: DESPESA, valorInicial: 100, valor: 900, saldoAtualizado: 1000, decreto: 'null/null', natureza: 'Suplementar', fonteRecurso: 1000, sequencia: 2 },
    ])
    const r = await svc.sincronizar('e1', 2026) // banco 900 ≠ atual 1000, pendência só S/N
    expect(r.status).toBe('DIVERGENTE')
    expect(r.mensagem).toContain('import manual')
    expect(prisma.creditoAdicional.create).not.toHaveBeenCalled()
  })

  it('remanejamento circular sem ordem viável → DIVERGENTE sem gravar', async () => {
    // A anula 600 em d1 e reforça 500 em d2; B reforça 500 em d1 e anula 500 em d2.
    // Equações fecham (d1: 100→0, d2: 0→0) mas nenhuma ordem cabe.
    prisma.dotacaoDespesa.findMany.mockResolvedValue([
      dotBanco('100'),
      { ...dotBanco('0'), id: 'd2', fonteRecurso: { codigo: '2000' } },
    ])
    stubPortal([
      { despesa: DESPESA, valorInicial: 600, valor: 600, saldoAtualizado: 0, decreto: 'A/2026', natureza: 'Reduzida', fonteRecurso: 1000, sequencia: 1 },
      { despesa: DESPESA, valorInicial: -500, valor: 500, saldoAtualizado: 0, decreto: 'B/2026', natureza: 'Suplementar', fonteRecurso: 1000, sequencia: 2 },
      { despesa: DESPESA, valorInicial: -500, valor: 500, saldoAtualizado: 0, decreto: 'A/2026', natureza: 'Suplementar', fonteRecurso: 2000, sequencia: 1 },
      { despesa: DESPESA, valorInicial: 500, valor: 500, saldoAtualizado: 0, decreto: 'B/2026', natureza: 'Reduzida', fonteRecurso: 2000, sequencia: 2 },
    ])
    const r = await svc.sincronizar('e1', 2026)
    expect(r.status).toBe('DIVERGENTE')
    expect(r.mensagem).toContain('ordem')
    expect(prisma.creditoAdicional.create).not.toHaveBeenCalled()
  })

  it('decreto dotando dotação-fonte NOVA cria fonte + dotação (autorizado 0) e lança', async () => {
    // portal traz fonte 2555 inexistente no banco; decreto 3/2026 a dota com 100
    const NOVA = '02.010.04.122.0002.2.001.3.3.90.30.00.00'
    stubPortal([{ despesa: NOVA, valorInicial: 0, valor: 100, saldoAtualizado: 100, decreto: '3/2026', natureza: 'Suplementar', fonteRecurso: 2555, sequencia: 1 }])
    prisma.dotacaoDespesa.findMany
      .mockResolvedValueOnce([dotBanco('900')]) // chaves (só fonte 1000; 2555 é nova)
      .mockResolvedValueOnce([{ ...dotBanco('0'), id: 'dNova' }]) // validação do criar
      .mockResolvedValueOnce([{ ...dotBanco('100'), id: 'dNova' }]) // verificação final
    prisma.fonteRecursoEntidade.findMany
      .mockResolvedValueOnce([]) // nenhuma fonte existente
      .mockResolvedValueOnce([{ id: 'f2555', codigo: '2555' }]) // pós-createMany
    prisma.unidadeOrcamentaria.findMany.mockResolvedValue([{ id: 'uo1', codigo: '02.010' }])
    prisma.funcao.findMany.mockResolvedValue([{ id: 'fn1', codigo: '04' }])
    prisma.subfuncao.findMany.mockResolvedValue([{ id: 'sf1', codigo: '122' }])
    prisma.programa.findMany.mockResolvedValue([{ id: 'pg1', codigo: '0002' }])
    prisma.acao.findMany.mockResolvedValue([{ id: 'ac1', codigo: '2001', programa: { codigo: '0002' } }])
    prisma.contaDespesaEntidade.findMany.mockResolvedValue([{ id: 'cd1', codigo: '3.3.90.30.00.00' }])
    prisma.dotacaoDespesa.create.mockResolvedValue({ id: 'dNova' })
    prisma.creditoAdicional.create.mockResolvedValue({ id: 'c1' })
    const r = await svc.sincronizar('e1', 2026)
    expect(r.status).toBe('OK')
    expect(prisma.fonteRecursoEntidade.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ codigo: '2555', origem: 'DESDOBRAMENTO' })] }),
    )
    expect(prisma.dotacaoDespesa.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ valorAutorizado: 0, fonteRecursoEntidadeId: 'f2555' }) }),
    )
    expect(prisma.creditoAdicional.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ numero: '3/2026' }) }),
    )
  })

  it('dotação nova com dimensão inexistente no banco → DIVERGENTE sem gravar', async () => {
    stubPortal([{ despesa: DESPESA, valorInicial: 0, valor: 100, saldoAtualizado: 100, decreto: '3/2026', natureza: 'Suplementar', fonteRecurso: 2555, sequencia: 1 }])
    prisma.dotacaoDespesa.findMany.mockResolvedValueOnce([dotBanco('900')])
    prisma.fonteRecursoEntidade.findMany.mockResolvedValue([{ id: 'f2555', codigo: '2555' }])
    prisma.unidadeOrcamentaria.findMany.mockResolvedValue([]) // uo não existe
    prisma.funcao.findMany.mockResolvedValue([])
    prisma.subfuncao.findMany.mockResolvedValue([])
    prisma.programa.findMany.mockResolvedValue([])
    prisma.acao.findMany.mockResolvedValue([])
    prisma.contaDespesaEntidade.findMany.mockResolvedValue([])
    const r = await svc.sincronizar('e1', 2026)
    expect(r.status).toBe('DIVERGENTE')
    expect(r.mensagem).toContain('dimensão inexistente')
    expect(prisma.creditoAdicional.create).not.toHaveBeenCalled()
  })

  it('verificação final acha dotação que não espelha o portal → DIVERGENTE (com o que foi lançado exposto)', async () => {
    stubPortal([{ despesa: DESPESA, valorInicial: 900, valor: 100, saldoAtualizado: 1000, decreto: '2/2026', natureza: 'Suplementar', fonteRecurso: 1000, sequencia: 1 }])
    prisma.dotacaoDespesa.findMany
      .mockResolvedValueOnce([dotBanco('900')])
      .mockResolvedValueOnce([dotBanco('900')])
      .mockResolvedValueOnce([dotBanco('999')]) // pós-write ≠ 1000
    prisma.creditoAdicional.create.mockResolvedValue({ id: 'c1' })
    const r = await svc.sincronizar('e1', 2026)
    expect(r.status).toBe('DIVERGENTE')
    expect(r.mensagem).toContain('verificação final')
  })

  it('sem orçamento → ERRO logado', async () => {
    prisma.orcamento.findUnique.mockResolvedValue(null)
    const r = await svc.sincronizar('e1', 2026)
    expect(r.status).toBe('ERRO')
    expect(prisma.sincronizacaoPortal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'DECRETOS', status: 'ERRO' }) }),
    )
  })

  it('erro de rede → ERRO logado, nada gravado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response))
    const r = await svc.sincronizar('e1', 2026)
    expect(r.status).toBe('ERRO')
    expect(prisma.creditoAdicional.create).not.toHaveBeenCalled()
  })
})
