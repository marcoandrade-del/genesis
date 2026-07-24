import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { SincronizacaoRepassesService } from '../sincronizacao-repasses.js'
import { TransferenciasFinanceirasService } from '../transferencias-financeiras.js'

/** stub do /api/repasses: devolve o mesmo YTD p/ qualquer entidade consultada. */
function stubPortal(valorLancado: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [{ valorLancado }] }) as Response),
  )
}

describe('SincronizacaoRepassesService', () => {
  let prisma: PrismaMock
  let svc: SincronizacaoRepassesService
  let registrar: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    prisma = criarPrismaMock()
    svc = new SincronizacaoRepassesService(prisma as never)
    registrar = vi.spyOn(TransferenciasFinanceirasService.prototype, 'registrar').mockResolvedValue(undefined as never)
    // defaults: entidade achada, contas [MOV], fonte existe, log grava
    prisma.entidade.findFirst.mockResolvedValue({ id: 'e1', nome: 'Câmara do Município de Maringá' })
    prisma.contaContabilEntidade.findMany.mockResolvedValue([
      { codigo: '1.1.1.1.1.30.00.00.00.00.00.00', admiteMovimento: true },
      { codigo: '4.5.1.1.2.02.00.00.00.00.00.00', admiteMovimento: true },
    ])
    prisma.fonteRecursoEntidade.findFirst.mockResolvedValue({ id: 'f1' })
    prisma.sincronizacaoPortal.create.mockResolvedValue({})
    prisma.transferenciaFinanceira.findFirst.mockResolvedValue(null) // sem ajuste hoje
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    registrar.mockRestore()
  })

  /** roda só o 1º alvo de Maringá (Câmara, modo delta). */
  const rodarCamara = async () => (await svc.sincronizarMunicipio('Maringá', 2026, 'u1'))[0]!

  it('booka o DELTA (portal − já lançado) como evento 900', async () => {
    stubPortal(42_092_170.75)
    prisma.transferenciaFinanceira.findMany.mockResolvedValue([{ valor: '36079003.50' }])
    const r = await rodarCamara()
    expect(r.status).toBe('OK')
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ entidadeId: 'e1', valor: '6013167.25', fonteCodigo: '1001' }))
  })

  it('SEM_DELTA quando o lançado já cobre o portal (não grava)', async () => {
    stubPortal(42_092_170.75)
    prisma.transferenciaFinanceira.findMany.mockResolvedValue([{ valor: '42092170.75' }])
    const r = await rodarCamara()
    expect(r.status).toBe('SEM_DELTA')
    expect(registrar).not.toHaveBeenCalled()
  })

  it('RPPS (modo resíduo) desconta a patronal orçamentária do alvo', async () => {
    stubPortal(59_100_000)
    // patronal já arrecadada como receita orçamentária: 38.264.926,58
    prisma.previsaoReceita.findMany.mockResolvedValue([{ valorArrecadado: '38264926.58' }])
    prisma.transferenciaFinanceira.findMany.mockResolvedValue([]) // nada bookado
    const rs = await svc.sincronizarMunicipio('Maringá', 2026, 'u1')
    const rpps = rs.find((r) => r.entidade.includes('Previdência') || r.mensagem.includes('20835073.42'))
    expect(rpps?.status).toBe('OK')
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ valor: '20835073.42' }))
  })

  it('fonte do ALVO sobrepõe a do município (câmara com fonte real provada na MSC)', async () => {
    stubPortal(1_000)
    prisma.transferenciaFinanceira.findMany.mockResolvedValue([]) // nada bookado
    prisma.previsaoReceita.findMany.mockResolvedValue([])
    // 1º alvo de Cianorte = Câmara, fonte '1501' no alvo (município default '9999')
    const r = (await svc.sincronizarMunicipio('Cianorte', 2026, 'u1'))[0]!
    expect(r.status).toBe('OK')
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ fonteCodigo: '1501', valor: '1000.00' }))
    // espelho concedido na Prefeitura sai com a MESMA fonte
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'CONCEDIDA', fonteCodigo: '1501' }))
  })

  it('ERRO (sem gravar) quando falta caixa/VPA [MOV] ou a fonte', async () => {
    stubPortal(1_000_000)
    prisma.transferenciaFinanceira.findMany.mockResolvedValue([])
    prisma.fonteRecursoEntidade.findFirst.mockResolvedValue(null) // fonte ausente
    const r = await rodarCamara()
    expect(r.status).toBe('ERRO')
    expect(registrar).not.toHaveBeenCalled()
  })

  it('não duplica o ajuste no mesmo dia (idempotência por entidade+data)', async () => {
    stubPortal(42_092_170.75)
    prisma.transferenciaFinanceira.findMany.mockResolvedValue([{ valor: '36079003.50' }])
    prisma.transferenciaFinanceira.findFirst.mockResolvedValue({ id: 'tf-hoje' }) // já ajustou hoje
    const r = await rodarCamara()
    expect(r.status).toBe('SEM_DELTA')
    expect(registrar).not.toHaveBeenCalled()
  })

  it('município sem alvos → PULADO', async () => {
    const rs = await svc.sincronizarMunicipio('Curitiba', 2026, 'u1')
    expect(rs[0]?.status).toBe('PULADO')
  })
})
