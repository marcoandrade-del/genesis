import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const m = vi.hoisted(() => ({ rcl: vi.fn(), rclConsolidada: vi.fn(), guardiao: vi.fn(), saldoFonte: vi.fn(), valRec: vi.fn(), valDesp: vi.fn(), saldoBanc: vi.fn(), indices: vi.fn(), disponibilidade: vi.fn(), metas: vi.fn(), dcl: vi.fn(), rgfSimples: vi.fn(), consistencia: vi.fn(), msc: vi.fn(), municipios: vi.fn() }))
vi.mock('../../services/consistencia.js', () => ({
  ConsistenciaService: class {
    verificar = m.consistencia
  },
}))
vi.mock('../../services/matriz-saldos-contabeis.js', () => ({
  MatrizSaldosContabeisService: class {
    emitir = m.msc
  },
}))
vi.mock('../../services/municipios-ativos.js', () => ({
  MunicipiosAtivosService: class {
    listar = m.municipios
  },
}))
vi.mock('../../services/dcl.js', () => ({
  DclService: class {
    calcular = m.dcl
  },
}))
vi.mock('../../services/rgf-simplificado.js', () => ({
  RgfSimplificadoService: class {
    calcular = m.rgfSimples
  },
}))
vi.mock('../../services/memorial-rcl.js', () => ({
  MemorialRclService: class {
    rcl = m.rcl
    rclConsolidada = m.rclConsolidada
  },
}))
vi.mock('../../services/memorial-guardiao.js', () => ({
  MemorialGuardiaoService: class {
    guardiao = m.guardiao
  },
}))
vi.mock('../../services/memorial-saldo-fonte.js', () => ({
  MemorialSaldoFonteService: class {
    saldoFonte = m.saldoFonte
  },
}))
vi.mock('../../services/valores-mensais.js', () => ({
  ValoresMensaisService: class {
    receita = m.valRec
    despesa = m.valDesp
  },
}))
vi.mock('../../services/saldo-bancario-mensal.js', () => ({
  SaldoBancarioMensalService: class {
    consolidar = m.saldoBanc
  },
}))
vi.mock('../../services/metas-fiscais.js', () => ({
  MetasFiscaisService: class {
    comparativo = m.metas
  },
}))
vi.mock('../../services/disponibilidade-fonte.js', () => ({
  DisponibilidadeFonteService: class {
    calcular = m.disponibilidade
  },
}))
vi.mock('../../services/indice-constitucional.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/indice-constitucional.js')>()),
  IndiceConstitucionalService: class {
    calcular = m.indices
  },
}))

import { criarApp } from '../../routes/__tests__/helpers/criarApp.js'
import type { PrismaMock } from '../../services/__tests__/helpers/prisma-mock.js'
import { memoriaisApiRoutes, CONTRATO_MEMORIAIS, CONTRATO_VALORES_MENSAIS, CONTRATO_SALDO_BANCARIO, CONTRATO_MUNICIPIOS } from '../memoriais.js'
import type { FastifyInstance } from 'fastify'

const TOKEN = 'segredo-de-teste'
const auth = { authorization: `Bearer ${TOKEN}` }

describe('memoriaisApiRoutes (data API versionada)', () => {
  let app: FastifyInstance
  let prisma: PrismaMock
  const envAntes = process.env.GENESIS_API_TOKEN

  beforeEach(async () => {
    m.rcl.mockReset()
    m.rclConsolidada.mockReset()
    m.guardiao.mockReset()
    m.saldoFonte.mockReset()
    m.valRec.mockReset()
    m.valDesp.mockReset()
    m.saldoBanc.mockReset()
    m.indices.mockReset()
    m.disponibilidade.mockReset()
    m.metas.mockReset()
    m.msc.mockReset()
    process.env.GENESIS_API_TOKEN = TOKEN
    ;({ app, prisma } = await criarApp({ registrar: memoriaisApiRoutes, prefix: '/api' }))
  })
  afterEach(() => {
    if (envAntes === undefined) delete process.env.GENESIS_API_TOKEN
    else process.env.GENESIS_API_TOKEN = envAntes
  })

  it('503 quando GENESIS_API_TOKEN não está configurado', async () => {
    delete process.env.GENESIS_API_TOKEN
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/contrato' })
    expect(res.statusCode).toBe(503)
  })

  it('401 sem token e com token errado', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/memoriais/contrato' })).statusCode).toBe(401)
    const r2 = await app.inject({ method: 'GET', url: '/api/memoriais/contrato', headers: { authorization: 'Bearer errado' } })
    expect(r2.statusCode).toBe(401)
  })

  it('GET /contrato devolve versão + recursos (o Oxy checa antes de consumir)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/contrato', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.versao).toBe(CONTRATO_MEMORIAIS.versao)
    expect(body.versao).toBe('1.13.0') // 1.10 selo; 1.11 despesa-consolidada; 1.12 receita-consolidada; 1.13 msc (aditivos → MINOR)
    const recursos = body.recursos.map((r: { recurso: string }) => r.recurso)
    expect(recursos).toContain('rcl')
    expect(recursos).toContain('dcl')
    expect(recursos).toContain('rgf-simplificado')
    expect(recursos).toContain('consistencia')
    expect(recursos).toContain('despesa-consolidada')
    expect(recursos).toContain('receita-consolidada')
    expect(recursos).toContain('msc')
  })

  it('200 MSC em envelope: mês repassado ao serviço; 400 sem mês válido', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1' })
    m.msc.mockResolvedValue({ entidade: { id: 'e1' }, ano: 2026, mes: 6, tipo: 'AGREGADA', linhas: [], verificacoes: [], selo: { aprovadas: 2, avaliadas: 2, total: 2 } })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/msc?entidadeId=e1&ano=2026&mes=6', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.contrato.recurso).toBe('msc')
    expect(body.dados.mes).toBe(6)
    expect(m.msc).toHaveBeenCalledWith('e1', 2026, 6)
    // sem mês, ou mês fora de 1..12, é 400 (nem chega no serviço)
    expect((await app.inject({ method: 'GET', url: '/api/memoriais/msc?entidadeId=e1&ano=2026', headers: auth })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/memoriais/msc?entidadeId=e1&ano=2026&mes=13', headers: auth })).statusCode).toBe(400)
  })

  it('200 consistência em envelope: selo N/M e verificações com Δ', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1' })
    m.consistencia.mockResolvedValue({
      verificacoes: [{ codigo: 'V1_ARRECADACAO', titulo: 'Arrecadação', status: 'OK', esperado: 100, obtido: 100, delta: 0, detalhe: 'x' }],
      selo: { aprovadas: 1, avaliadas: 1, total: 1 },
    })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/consistencia?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.contrato.recurso).toBe('consistencia')
    expect(body.dados.selo).toEqual({ aprovadas: 1, avaliadas: 1, total: 1 })
    expect(m.consistencia).toHaveBeenCalledWith('e1', 2026)
  })

  it('200 DCL em envelope versionado', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1' })
    m.dcl.mockResolvedValue({ dcl: -539.62, dividaTotal: 544.32 })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/dcl?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.contrato.recurso).toBe('dcl')
    expect(body.dados.dcl).toBe(-539.62)
    expect(m.dcl).toHaveBeenCalledWith('e1', 2026)
  })

  it('200 RGF simplificado em envelope; q default 3, q=2 respeitado', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1' })
    m.rgfSimples.mockResolvedValue({ temOrcamento: true, linhas: [] })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/rgf-simplificado?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().contrato.recurso).toBe('rgf-simplificado')
    expect(m.rgfSimples).toHaveBeenCalledWith('e1', 2026, 3)
    await app.inject({ method: 'GET', url: '/api/memoriais/rgf-simplificado?entidadeId=e1&ano=2026&q=2', headers: auth })
    expect(m.rgfSimples).toHaveBeenLastCalledWith('e1', 2026, 2)
  })

  it('400 quando faltam entidadeId/ano', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/memoriais/rcl', headers: auth })).statusCode).toBe(400)
    // entidadeId presente mas ano inválido também é 400
    expect((await app.inject({ method: 'GET', url: '/api/memoriais/rcl?entidadeId=e1', headers: auth })).statusCode).toBe(400)
  })

  it('200 RCL em envelope versionado', async () => {
    m.rcl.mockResolvedValue({ rcl: 1000 })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/rcl?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.contrato.versao).toBe(CONTRATO_MEMORIAIS.versao)
    expect(body.contrato.recurso).toBe('rcl')
    expect(body.dados.rcl).toBe(1000)
    expect(m.rcl).toHaveBeenCalledWith('e1', 2026)
  })

  it('404 quando a entidade não existe', async () => {
    m.rcl.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/rcl?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 RCL consolidada em envelope', async () => {
    m.rclConsolidada.mockResolvedValue({ rclTotal: 500 })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/rcl-consolidada?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().contrato.recurso).toBe('rcl-consolidada')
    expect(res.json().dados.rclTotal).toBe(500)
  })

  it('404 consolidada quando não existe', async () => {
    m.rclConsolidada.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/rcl-consolidada?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 Guardião (lista de indicadores) em envelope', async () => {
    m.guardiao.mockResolvedValue({ indicadores: [{ indicador: 'Despesa com Pessoal' }] })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/guardiao?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().contrato.recurso).toBe('guardiao')
    expect(res.json().dados.indicadores[0].indicador).toBe('Despesa com Pessoal')
  })

  it('404 Guardião quando a entidade não existe', async () => {
    m.guardiao.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/guardiao?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 saldo por fonte (receita+despesa por finalidade) em envelope', async () => {
    m.saldoFonte.mockResolvedValue({ receita: { porFinalidade: [{ finalidade: 'MDE' }] }, despesa: { porFinalidade: [] } })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/saldo-fonte?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().contrato.recurso).toBe('saldo-fonte')
    expect(res.json().dados.receita.porFinalidade[0].finalidade).toBe('MDE')
    expect(m.saldoFonte).toHaveBeenCalledWith('e1', 2026)
  })

  it('404 saldo por fonte quando a entidade não existe', async () => {
    m.saldoFonte.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/saldo-fonte?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 índices constitucionais (MDE/ASPS) em envelope', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ municipio: { estado: { sigla: 'PR' } } })
    m.indices.mockResolvedValue({ baseTotal: 1500, mde: { percentual: 30, atende: true }, asps: { percentual: 16, atende: true } })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/indices-constitucionais?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.contrato.recurso).toBe('indices-constitucionais')
    expect(body.dados.mde.percentual).toBe(30)
    // composição resolvida pelo Estado da entidade (PR) e repassada ao service
    expect(m.indices).toHaveBeenCalledWith('e1', 2026, expect.objectContaining({ nome: expect.stringContaining('TCE-PR') }))
  })

  it('404 índices quando a entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/indices-constitucionais?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 disponibilidade por fonte (RGF Anexo 5) em envelope', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1' })
    m.disponibilidade.mockResolvedValue({ temDados: true, linhas: [{ fonte: '1000', disponibilidade: 400 }], totais: { disponibilidade: 400 } })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/disponibilidade-fonte?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().contrato.recurso).toBe('disponibilidade-fonte')
    expect(res.json().dados.totais.disponibilidade).toBe(400)
    expect(m.disponibilidade).toHaveBeenCalledWith('e1', 2026)
  })

  it('404 disponibilidade quando a entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/disponibilidade-fonte?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 metas fiscais em envelope', async () => {
    prisma.entidade.findUnique.mockResolvedValue({ id: 'e1' })
    m.metas.mockResolvedValue({ temMetas: true, linhas: [{ rotulo: 'Receita Total', valorMeta: 3000, projetado: 3170, diferenca: 170 }] })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/metas-fiscais?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().contrato.recurso).toBe('metas-fiscais')
    expect(res.json().dados.linhas[0].diferenca).toBe(170)
    expect(m.metas).toHaveBeenCalledWith('e1', 2026)
  })

  it('404 metas quando a entidade não existe', async () => {
    prisma.entidade.findUnique.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/metas-fiscais?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 valores-mensais receita — contrato PRÓPRIO valores-mensais', async () => {
    m.valRec.mockResolvedValue({ entidade: { id: 'e1', nome: 'Pref', estado: 'PR' }, ano: 2026, mesesRealizados: 6, contas: [{ codigo: '1.1.1' }] })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/valores-mensais?entidadeId=e1&ano=2026&tipo=receita', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.contrato.nome).toBe(CONTRATO_VALORES_MENSAIS.nome)
    expect(body.contrato.versao).toBe(CONTRATO_VALORES_MENSAIS.versao)
    expect(body.contrato.recurso).toBe('receita')
    expect(body.dados.contas[0].codigo).toBe('1.1.1')
    expect(m.valRec).toHaveBeenCalledWith('e1', 2026)
  })

  it('200 valores-mensais despesa', async () => {
    m.valDesp.mockResolvedValue({ entidade: { id: 'e1', nome: 'Pref', estado: 'PR' }, ano: 2026, mesesRealizados: 6, itens: [{ grupo: 'Pessoal e Encargos' }] })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/valores-mensais?entidadeId=e1&ano=2026&tipo=despesa', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().contrato.recurso).toBe('despesa')
    expect(res.json().dados.itens[0].grupo).toBe('Pessoal e Encargos')
    expect(m.valDesp).toHaveBeenCalledWith('e1', 2026)
  })

  it('400 valores-mensais com tipo inválido', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/valores-mensais?entidadeId=e1&ano=2026&tipo=banana', headers: auth })
    expect(res.statusCode).toBe(400)
  })

  it('404 valores-mensais quando a entidade não existe', async () => {
    m.valRec.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/valores-mensais?entidadeId=x&ano=2026&tipo=receita', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 saldo-bancario — contrato próprio saldo-bancario', async () => {
    m.saldoBanc.mockResolvedValue({ entidade: { id: 'e1', nome: 'Pref', estado: 'PR' }, ano: 2026, mesesRealizados: 6, contas: [{ rotulo: '001 ag. 1 c/c 2', saldoMensal: [100], movimentacaoMensal: [50] }] })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/saldo-bancario?entidadeId=e1&ano=2026', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.contrato.nome).toBe(CONTRATO_SALDO_BANCARIO.nome)
    expect(body.contrato.versao).toBe(CONTRATO_SALDO_BANCARIO.versao)
    expect(body.dados.contas[0].rotulo).toBe('001 ag. 1 c/c 2')
    expect(m.saldoBanc).toHaveBeenCalledWith('e1', 2026)
  })

  it('404 saldo-bancario quando a entidade não existe', async () => {
    m.saldoBanc.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/saldo-bancario?entidadeId=x&ano=2026', headers: auth })
    expect(res.statusCode).toBe(404)
  })

  it('200 catálogo de municípios — contrato próprio municipios (sem params)', async () => {
    m.municipios.mockResolvedValue({
      municipios: [
        { id: 'mun-1', nome: 'Maringá', estado: 'PR', prefeitura: { id: 'ent-1', nome: 'Prefeitura', cnpj: '76.282.656/0001-06', anosComOrcamento: [2026] } },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/api/memoriais/municipios', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.contrato.nome).toBe(CONTRATO_MUNICIPIOS.nome)
    expect(body.contrato.versao).toBe(CONTRATO_MUNICIPIOS.versao)
    expect(body.contrato.recurso).toBe('municipios')
    expect(body.dados.municipios[0].nome).toBe('Maringá')
    expect(body.dados.municipios[0].prefeitura.anosComOrcamento).toEqual([2026])
  })

  it('401 catálogo de municípios sem token (herda o hook de auth)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/memoriais/municipios' })).statusCode).toBe(401)
  })
})
