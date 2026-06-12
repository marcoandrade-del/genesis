import { describe, it, expect, beforeEach } from 'vitest'
import { AberturaExercicioService } from '../abertura-exercicio.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

let prisma: PrismaMock
let service: AberturaExercicioService

beforeEach(() => {
  prisma = criarPrismaMock()
  service = new AberturaExercicioService(prisma as never)
})

const ENTIDADE = {
  id: 'ent1',
  nome: 'Prefeitura de Curitiba',
  municipio: { modeloContabilId: null, estado: { modeloContabilId: 'mod1' } },
}

function armarModelo() {
  prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
  prisma.planoDeContas.findFirst.mockResolvedValue({ id: 'pc1' })
  prisma.planoContasReceita.findFirst.mockResolvedValue({ id: 'pr1' })
  prisma.planoContasDespesa.findFirst.mockResolvedValue({ id: 'pd1' })
  prisma.fonteRecurso.findMany.mockResolvedValue([
    { id: 'f1', codigo: '500', nomenclatura: 'Livres', especificacao: null, vinculada: false, grupo: null },
  ])
  // árvore contábil: pai + filho (testa remapeamento de parentId)
  prisma.conta.findMany.mockResolvedValue([
    { id: 'm1', codigo: '1', descricao: 'Ativo', nivel: 1, admiteMovimento: false, parentId: null },
    { id: 'm2', codigo: '1.1', descricao: 'Caixa', nivel: 2, admiteMovimento: true, parentId: 'm1' },
  ])
  prisma.contaReceita.findMany.mockResolvedValue([
    { id: 'r1', codigo: '1', descricao: 'Receitas', nivel: 1, admiteMovimento: true, parentId: null },
  ])
  prisma.contaDespesa.findMany.mockResolvedValue([])
}

describe('AberturaExercicioService.abrir', () => {
  it('copia as árvores + fontes do modelo para o ano novo (origem MODELO, parentId remapeado)', async () => {
    armarModelo()
    prisma.planoContasDespesa.findFirst.mockResolvedValue(null) // modelo sem despesa do ano: copia o que tem
    const r = await service.abrir('ent1', 2027)

    expect(r).toEqual({ entidadeId: 'ent1', nome: 'Prefeitura de Curitiba', ano: 2027, contabil: 2, receita: 1, despesa: 0, fontes: 1 })

    const linhas = prisma.contaContabilEntidade.createMany.mock.calls[0][0].data
    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toMatchObject({ entidadeId: 'ent1', ano: 2027, codigo: '1', origem: 'MODELO', modeloContaId: 'm1', parentId: null })
    expect(linhas[1]).toMatchObject({ codigo: '1.1', modeloContaId: 'm2' })
    expect(linhas[1].parentId).toBe(linhas[0].id) // remapeado p/ o id da CÓPIA do pai

    expect(prisma.contaReceitaEntidade.createMany).toHaveBeenCalled()
    expect(prisma.contaDespesaEntidade.createMany).not.toHaveBeenCalled()
    const fontes = prisma.fonteRecursoEntidade.createMany.mock.calls[0][0].data
    expect(fontes[0]).toMatchObject({ entidadeId: 'ent1', ano: 2027, codigo: '500', origem: 'MODELO', modeloFonteId: 'f1' })
  })

  it('herda o modelo do município quando definido', async () => {
    armarModelo()
    prisma.entidade.findUnique.mockResolvedValue({
      ...ENTIDADE,
      municipio: { modeloContabilId: 'modMun', estado: { modeloContabilId: 'mod1' } },
    })
    await service.abrir('ent1', 2027)
    expect(prisma.planoDeContas.findFirst).toHaveBeenCalledWith({ where: { modeloContabilId: 'modMun', ano: 2027 } })
  })

  it('rejeita ano inválido sem consultar nada', async () => {
    await expect(service.abrir('ent1', NaN)).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    await expect(service.abrir('ent1', 27)).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(prisma.entidade.findUnique).not.toHaveBeenCalled()
  })

  it('rejeita entidade inexistente e município/estado sem modelo', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    await expect(service.abrir('x', 2027)).rejects.toMatchObject({ code: 'RECURSO_NAO_ENCONTRADO' })
    prisma.entidade.findUnique.mockResolvedValue({
      ...ENTIDADE,
      municipio: { modeloContabilId: null, estado: { modeloContabilId: null } },
    })
    await expect(service.abrir('ent1', 2027)).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
  })

  it('CONFLITO quando o exercício já tem qualquer cópia (manda ressincronizar)', async () => {
    armarModelo()
    prisma.contaReceitaEntidade.count.mockResolvedValue(3)
    await expect(service.abrir('ent1', 2026)).rejects.toMatchObject({ code: 'CONFLITO' })
    expect(prisma.contaContabilEntidade.createMany).not.toHaveBeenCalled()
  })

  it('modelo só com fontes do ano (sem planos) → copia só as fontes', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.planoDeContas.findFirst.mockResolvedValue(null)
    prisma.planoContasReceita.findFirst.mockResolvedValue(null)
    prisma.planoContasDespesa.findFirst.mockResolvedValue(null)
    prisma.fonteRecurso.findMany.mockResolvedValue([
      { id: 'f1', codigo: '500', nomenclatura: 'Livres', especificacao: null, vinculada: false, grupo: null },
    ])
    const r = await service.abrir('ent1', 2027)
    expect(r).toMatchObject({ contabil: 0, receita: 0, despesa: 0, fontes: 1 })
    expect(prisma.contaContabilEntidade.createMany).not.toHaveBeenCalled()
    expect(prisma.contaReceitaEntidade.createMany).not.toHaveBeenCalled()
    expect(prisma.fonteRecursoEntidade.createMany).toHaveBeenCalled()
  })

  it('modelo com planos mas sem fontes do ano → copia só as árvores', async () => {
    armarModelo()
    prisma.fonteRecurso.findMany.mockResolvedValue([])
    const r = await service.abrir('ent1', 2027)
    expect(r.fontes).toBe(0)
    expect(prisma.fonteRecursoEntidade.createMany).not.toHaveBeenCalled()
    expect(prisma.contaDespesaEntidade.createMany).not.toHaveBeenCalled() // contasDespesa=[] no fixture
  })

  it('erro claro quando o modelo não tem NENHUM plano/fonte do ano', async () => {
    prisma.entidade.findUnique.mockResolvedValue(ENTIDADE)
    prisma.planoDeContas.findFirst.mockResolvedValue(null)
    prisma.planoContasReceita.findFirst.mockResolvedValue(null)
    prisma.planoContasDespesa.findFirst.mockResolvedValue(null)
    prisma.fonteRecurso.findMany.mockResolvedValue([])
    await expect(service.abrir('ent1', 2030)).rejects.toMatchObject({ code: 'ENTIDADE_NAO_PROCESSAVEL' })
    await expect(service.abrir('ent1', 2030)).rejects.toThrow(/não tem planos para 2030/)
  })
})
