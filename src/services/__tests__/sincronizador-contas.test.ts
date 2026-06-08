import { describe, it, expect, beforeEach } from 'vitest'
import { SincronizadorContas } from '../sincronizador-contas.js'
import { ErroNegocio } from '../../errors.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

// O sincronizador recebe o `tx` da transação; nos testes passamos o próprio mock.
const tx = (m: PrismaMock) => m as unknown as Parameters<SincronizadorContas['contaCriada']>[0]

const CONTA = { id: 'c9', codigo: '1.1.1.01', descricao: 'IPTU', nivel: 4, admiteMovimento: true, parentId: 'pai-modelo' }
const PLANO = { ano: 2026, modeloContabilId: 'm1' }

describe('SincronizadorContas', () => {
  let prisma: PrismaMock
  let sync: SincronizadorContas

  beforeEach(() => {
    prisma = criarPrismaMock()
    sync = new SincronizadorContas()
  })

  describe('contaCriada', () => {
    it('com pai: cria a cópia em cada entidade, ancorando na cópia do pai', async () => {
      prisma.contaContabilEntidade.findMany.mockResolvedValue([
        { id: 'pe1', entidadeId: 'e1', ano: 2026 },
        { id: 'pe2', entidadeId: 'e2', ano: 2026 },
      ])
      await sync.contaCriada(tx(prisma), 'CONTABIL', CONTA, PLANO)
      expect(prisma.contaContabilEntidade.findMany).toHaveBeenCalledWith({
        where: { modeloContaId: 'pai-modelo', origem: 'MODELO' },
        select: { id: true, entidadeId: true, ano: true },
      })
      expect(prisma.contaContabilEntidade.createMany).toHaveBeenCalledWith({
        data: [
          { entidadeId: 'e1', ano: 2026, codigo: '1.1.1.01', descricao: 'IPTU', nivel: 4, admiteMovimento: true, origem: 'MODELO', modeloContaId: 'c9', parentId: 'pe1' },
          { entidadeId: 'e2', ano: 2026, codigo: '1.1.1.01', descricao: 'IPTU', nivel: 4, admiteMovimento: true, origem: 'MODELO', modeloContaId: 'c9', parentId: 'pe2' },
        ],
      })
    })

    it('com pai mas nenhuma entidade tem a cópia → não cria nada', async () => {
      prisma.contaContabilEntidade.findMany.mockResolvedValue([])
      await sync.contaCriada(tx(prisma), 'CONTABIL', CONTA, PLANO)
      expect(prisma.contaContabilEntidade.createMany).not.toHaveBeenCalled()
    })

    it('conta raiz: resolve entidades do modelo (com árvore no ano) e cria com parentId null', async () => {
      prisma.entidade.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])
      prisma.contaContabilEntidade.findMany.mockResolvedValue([{ entidadeId: 'e1' }, { entidadeId: 'e2' }])
      await sync.contaCriada(tx(prisma), 'CONTABIL', { ...CONTA, parentId: null, nivel: 1 }, PLANO)
      expect(prisma.entidade.findMany).toHaveBeenCalledWith({
        where: { municipio: { OR: [{ modeloContabilId: 'm1' }, { modeloContabilId: null, estado: { modeloContabilId: 'm1' } }] } },
        select: { id: true },
      })
      const arg = prisma.contaContabilEntidade.createMany.mock.calls[0]![0]
      expect(arg.data).toHaveLength(2)
      expect(arg.data[0]).toMatchObject({ entidadeId: 'e1', parentId: null, modeloContaId: 'c9' })
    })

    it('conta raiz sem entidades no modelo → não cria nada', async () => {
      prisma.entidade.findMany.mockResolvedValue([])
      await sync.contaCriada(tx(prisma), 'CONTABIL', { ...CONTA, parentId: null }, PLANO)
      expect(prisma.contaContabilEntidade.createMany).not.toHaveBeenCalled()
    })
  })

  describe('contaAtualizada / contaExcluida — bloqueio por desdobramento', () => {
    it('atualiza as cópias quando não há desdobramento', async () => {
      prisma.contaReceitaEntidade.findMany.mockResolvedValue([{ id: 'x1' }, { id: 'x2' }])
      prisma.contaReceitaEntidade.count.mockResolvedValue(0)
      await sync.contaAtualizada(tx(prisma), 'RECEITA', CONTA)
      expect(prisma.contaReceitaEntidade.count).toHaveBeenCalledWith({
        where: { parentId: { in: ['x1', 'x2'] }, origem: 'DESDOBRAMENTO' },
      })
      expect(prisma.contaReceitaEntidade.updateMany).toHaveBeenCalledWith({
        where: { modeloContaId: 'c9', origem: 'MODELO' },
        data: { codigo: '1.1.1.01', descricao: 'IPTU', admiteMovimento: true },
      })
    })

    it('BLOQUEIA a atualização quando alguma entidade desdobrou abaixo', async () => {
      prisma.contaDespesaEntidade.findMany.mockResolvedValue([{ id: 'x1' }])
      prisma.contaDespesaEntidade.count.mockResolvedValue(1)
      await expect(sync.contaAtualizada(tx(prisma), 'DESPESA', CONTA)).rejects.toBeInstanceOf(ErroNegocio)
      expect(prisma.contaDespesaEntidade.updateMany).not.toHaveBeenCalled()
    })

    it('sem cópias → não bloqueia e atualiza (no-op de updateMany)', async () => {
      prisma.contaContabilEntidade.findMany.mockResolvedValue([])
      await sync.contaAtualizada(tx(prisma), 'CONTABIL', CONTA)
      expect(prisma.contaContabilEntidade.count).not.toHaveBeenCalled()
      expect(prisma.contaContabilEntidade.updateMany).toHaveBeenCalled()
    })

    it('exclui as cópias quando não há desdobramento', async () => {
      prisma.contaContabilEntidade.findMany.mockResolvedValue([{ id: 'x1' }])
      prisma.contaContabilEntidade.count.mockResolvedValue(0)
      await sync.contaExcluida(tx(prisma), 'CONTABIL', 'c9')
      expect(prisma.contaContabilEntidade.deleteMany).toHaveBeenCalledWith({ where: { modeloContaId: 'c9', origem: 'MODELO' } })
    })

    it('BLOQUEIA a exclusão quando há desdobramento', async () => {
      prisma.contaContabilEntidade.findMany.mockResolvedValue([{ id: 'x1' }])
      prisma.contaContabilEntidade.count.mockResolvedValue(2)
      await expect(sync.contaExcluida(tx(prisma), 'CONTABIL', 'c9')).rejects.toBeInstanceOf(ErroNegocio)
      expect(prisma.contaContabilEntidade.deleteMany).not.toHaveBeenCalled()
    })
  })

  describe('fontes de recurso', () => {
    const FONTE = { id: 'f9', ano: 2026, codigo: '540', nomenclatura: 'Educação', especificacao: 'MDE', vinculada: true, grupo: 'Educação', modeloContabilId: 'm1' }

    it('fonteCriada: cria cópia nas entidades onboardadas no ano', async () => {
      prisma.entidade.findMany.mockResolvedValue([{ id: 'e1' }])
      prisma.contaContabilEntidade.findMany.mockResolvedValue([{ entidadeId: 'e1' }])
      await sync.fonteCriada(tx(prisma), FONTE)
      expect(prisma.fonteRecursoEntidade.createMany).toHaveBeenCalledWith({
        data: [{ entidadeId: 'e1', ano: 2026, codigo: '540', nomenclatura: 'Educação', especificacao: 'MDE', vinculada: true, grupo: 'Educação', origem: 'MODELO', modeloFonteId: 'f9' }],
      })
    })

    it('fonteCriada sem entidades → não cria', async () => {
      prisma.entidade.findMany.mockResolvedValue([])
      await sync.fonteCriada(tx(prisma), FONTE)
      expect(prisma.fonteRecursoEntidade.createMany).not.toHaveBeenCalled()
    })

    it('fonteAtualizada: updateMany pelas cópias', async () => {
      await sync.fonteAtualizada(tx(prisma), FONTE)
      expect(prisma.fonteRecursoEntidade.updateMany).toHaveBeenCalledWith({
        where: { modeloFonteId: 'f9' },
        data: { nomenclatura: 'Educação', especificacao: 'MDE', vinculada: true, grupo: 'Educação' },
      })
    })

    it('fonteExcluida: exclui quando nenhuma cópia está em uso', async () => {
      prisma.fonteRecursoEntidade.findMany.mockResolvedValue([{ id: 'fe1', _count: { dotacoes: 0, previsoes: 0 } }])
      await sync.fonteExcluida(tx(prisma), 'f9')
      expect(prisma.fonteRecursoEntidade.deleteMany).toHaveBeenCalledWith({ where: { modeloFonteId: 'f9' } })
    })

    it('fonteExcluida: BLOQUEIA quando cópia está em uso (dotação/previsão)', async () => {
      prisma.fonteRecursoEntidade.findMany.mockResolvedValue([{ id: 'fe1', _count: { dotacoes: 0, previsoes: 3 } }])
      await expect(sync.fonteExcluida(tx(prisma), 'f9')).rejects.toBeInstanceOf(ErroNegocio)
      expect(prisma.fonteRecursoEntidade.deleteMany).not.toHaveBeenCalled()
    })
  })
})
