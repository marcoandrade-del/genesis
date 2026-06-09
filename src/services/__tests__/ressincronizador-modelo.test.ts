import { describe, it, expect, beforeEach } from 'vitest'
import { RessincronizadorModelo, descreverResumo, type ResumoLote } from '../ressincronizador-modelo.js'
import { ErroNegocio } from '../../errors.js'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'

const prismaDe = (m: PrismaMock) => m as unknown as ConstructorParameters<typeof RessincronizadorModelo>[0]

// Entidade "pronta para ressincronizar": modelo herdado do estado, sem desdobramento/execução.
function prepararEntidadeSincronizavel(prisma: PrismaMock) {
  prisma.entidade.findUnique.mockResolvedValue({
    id: 'e1',
    nome: 'Prefeitura',
    municipio: { modeloContabilId: null, estado: { modeloContabilId: 'm1' } },
  })
  // anosComCopias: só o contábil retorna ano; os outros ficam no default [].
  prisma.contaContabilEntidade.findMany.mockResolvedValue([{ ano: 2026 }])
  // Planos do modelo existem para 2026.
  prisma.planoDeContas.findFirst.mockResolvedValue({ id: 'pc' })
  prisma.planoContasReceita.findFirst.mockResolvedValue({ id: 'pr' })
  prisma.planoContasDespesa.findFirst.mockResolvedValue({ id: 'pd' })
  prisma.fonteRecurso.findMany.mockResolvedValue([
    { id: 'f1', codigo: '500', nomenclatura: 'Recursos livres', especificacao: null, vinculada: false, grupo: null },
  ])
  // Árvores do modelo.
  prisma.conta.findMany.mockResolvedValue([
    { id: 'c1', codigo: '1', descricao: 'ATIVO', nivel: 1, admiteMovimento: false, parentId: null },
    { id: 'c2', codigo: '1.1', descricao: 'CIRCULANTE', nivel: 2, admiteMovimento: true, parentId: 'c1' },
  ])
  prisma.contaReceita.findMany.mockResolvedValue([
    { id: 'r1', codigo: '1', descricao: 'RECEITAS', nivel: 1, admiteMovimento: true, parentId: null },
  ])
  prisma.contaDespesa.findMany.mockResolvedValue([
    { id: 'd1', codigo: '3', descricao: 'DESPESAS', nivel: 1, admiteMovimento: true, parentId: null },
  ])
}

describe('RessincronizadorModelo', () => {
  let prisma: PrismaMock
  let svc: RessincronizadorModelo

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new RessincronizadorModelo(prismaDe(prisma))
  })

  describe('ressincronizarEntidade', () => {
    it('recopia as 4 árvores e retorna as contagens', async () => {
      prepararEntidadeSincronizavel(prisma)

      const r = await svc.ressincronizarEntidade('e1')

      expect(r.status).toBe('ressincronizada')
      expect(r).toMatchObject({ contabil: 2, receita: 1, despesa: 1, fontes: 1 })
      // Apaga as cópias MODELO do ano antes de recriar.
      expect(prisma.contaContabilEntidade.deleteMany).toHaveBeenCalledWith({
        where: { entidadeId: 'e1', ano: 2026, origem: 'MODELO' },
      })
      expect(prisma.fonteRecursoEntidade.deleteMany).toHaveBeenCalledWith({
        where: { entidadeId: 'e1', ano: 2026, origem: 'MODELO' },
      })
    })

    it('remapeia parentId e marca origem=MODELO com vínculo ao modelo', async () => {
      prepararEntidadeSincronizavel(prisma)
      await svc.ressincronizarEntidade('e1')

      const data = prisma.contaContabilEntidade.createMany.mock.calls[0]![0].data as Array<Record<string, unknown>>
      const porCodigo = Object.fromEntries(data.map((x) => [x['codigo'], x]))
      expect(porCodigo['1']!['parentId']).toBeNull()
      expect(porCodigo['1']!['origem']).toBe('MODELO')
      expect(porCodigo['1']!['modeloContaId']).toBe('c1')
      // Filho ancora no id NOVO do pai (não no id do modelo).
      expect(porCodigo['1.1']!['parentId']).toBe(porCodigo['1']!['id'])
      expect(porCodigo['1.1']!['modeloContaId']).toBe('c2')
    })

    it('PULA (sem escrever) quando há desdobramento', async () => {
      prepararEntidadeSincronizavel(prisma)
      prisma.contaContabilEntidade.count.mockResolvedValue(3) // 3 desdobramentos

      const r = await svc.ressincronizarEntidade('e1')

      expect(r.status).toBe('pulada')
      expect(r.motivo).toContain('desdobramento')
      expect(prisma.contaContabilEntidade.deleteMany).not.toHaveBeenCalled()
      expect(prisma.contaContabilEntidade.createMany).not.toHaveBeenCalled()
    })

    it('PULA quando há execução (lançamento ou orçamento)', async () => {
      prepararEntidadeSincronizavel(prisma)
      prisma.lancamento.count.mockResolvedValue(1)

      const r = await svc.ressincronizarEntidade('e1')

      expect(r.status).toBe('pulada')
      expect(prisma.contaContabilEntidade.deleteMany).not.toHaveBeenCalled()
    })

    it('NÃO toca um plano-tipo cujo modelo não tem plano no ano', async () => {
      prepararEntidadeSincronizavel(prisma)
      prisma.planoContasDespesa.findFirst.mockResolvedValue(null) // sem plano de despesa

      const r = await svc.ressincronizarEntidade('e1')

      expect(r.despesa).toBe(0)
      expect(prisma.contaDespesaEntidade.deleteMany).not.toHaveBeenCalled()
      // Os outros planos seguem sendo recopiados.
      expect(prisma.contaContabilEntidade.deleteMany).toHaveBeenCalled()
    })

    it('status sem-modelo quando município e estado não têm modelo', async () => {
      prisma.entidade.findUnique.mockResolvedValue({
        id: 'e1',
        nome: 'Prefeitura',
        municipio: { modeloContabilId: null, estado: { modeloContabilId: null } },
      })

      const r = await svc.ressincronizarEntidade('e1')

      expect(r.status).toBe('sem-modelo')
      expect(prisma.contaContabilEntidade.deleteMany).not.toHaveBeenCalled()
    })

    it('erro quando a entidade não existe', async () => {
      prisma.entidade.findUnique.mockResolvedValue(null)
      await expect(svc.ressincronizarEntidade('x')).rejects.toBeInstanceOf(ErroNegocio)
    })
  })

  describe('ressincronizarMunicipio', () => {
    it('processa todas as entidades do município e agrega', async () => {
      prisma.municipio.findUnique.mockResolvedValue({ id: 'mun1' })
      prisma.entidade.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])
      // Cada entidade resolve sem modelo → status sem-modelo (caminho curto).
      prisma.entidade.findUnique.mockResolvedValue({
        id: 'e', nome: 'E', municipio: { modeloContabilId: null, estado: { modeloContabilId: null } },
      })

      const r = await svc.ressincronizarMunicipio('mun1')

      expect(r.total).toBe(2)
      expect(r.semModelo).toBe(2)
      expect(r.ressincronizadas).toBe(0)
    })

    it('erro quando o município não existe', async () => {
      prisma.municipio.findUnique.mockResolvedValue(null)
      await expect(svc.ressincronizarMunicipio('x')).rejects.toBeInstanceOf(ErroNegocio)
    })
  })

  describe('ressincronizarEstado', () => {
    it('processa as entidades de todos os municípios do estado', async () => {
      prisma.estado.findUnique.mockResolvedValue({ id: 'uf1' })
      prisma.entidade.findMany.mockResolvedValue([{ id: 'e1' }])
      prisma.entidade.findUnique.mockResolvedValue({
        id: 'e1', nome: 'E', municipio: { modeloContabilId: null, estado: { modeloContabilId: null } },
      })

      const r = await svc.ressincronizarEstado('uf1')

      expect(r.total).toBe(1)
      expect(prisma.entidade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { municipio: { estadoId: 'uf1' } } }),
      )
    })

    it('erro quando o estado não existe', async () => {
      prisma.estado.findUnique.mockResolvedValue(null)
      await expect(svc.ressincronizarEstado('x')).rejects.toBeInstanceOf(ErroNegocio)
    })
  })

  describe('descreverResumo', () => {
    const base: ResumoLote = { total: 0, ressincronizadas: 0, puladas: 0, semModelo: 0, entidades: [] }

    it('vazio', () => {
      expect(descreverResumo(base)).toContain('Nenhuma entidade')
    })
    it('só ressincronizadas', () => {
      expect(descreverResumo({ ...base, total: 4, ressincronizadas: 4 })).toBe('4 entidade(s): 4 ressincronizada(s).')
    })
    it('com puladas e sem-modelo', () => {
      const t = descreverResumo({ ...base, total: 3, ressincronizadas: 1, puladas: 1, semModelo: 1 })
      expect(t).toContain('1 pulada(s)')
      expect(t).toContain('1 sem modelo')
    })
  })
})
