import { PrismaClient, Prisma } from '@prisma/client'
import { TransferenciasFinanceirasService } from './transferencias-financeiras.js'
import { CONTAS_EVENTO } from './motor-eventos-receita.js'

/**
 * Re-sincronização dos REPASSES RECEBIDOS (evento 900) com o portal Elotech —
 * os valores YTD do `/api/repasses?tipo=R` ENVELHECEM (o snapshot bookado fica
 * para trás conforme o Executivo repassa); este serviço booka o DELTA
 * (portal − já lançado) como nova transferência financeira, idempotente e
 * auditável ([[conversor-turn-key-tracker]], padrão provado no #281).
 *
 * Alvos por MUNICÍPIO (config estática, match por substring do nome no banco —
 * validada nos imports #275/#276/#280/#281):
 *  - Prefeitura (tipo E no portal) CONCEDE — nunca é alvo.
 *  - RPPS: modo 'residuo' — o repasse do portal INCLUI a contribuição patronal
 *    que JÁ é receita orçamentária (natureza 1.2.1.5.01 "PREFEITURA MUNICIPAL");
 *    o alvo é só o excedente (aporte financeiro), senão duplica (decisão do
 *    Marco no #281). alvo = portal − patronal arrecadada; delta = alvo − booked.
 *  - Demais (câmara/fundos/autarquias): modo 'delta' simples.
 *
 * Toda execução (OK/DIVERGENTE/ERRO) é logada em `SincronizacaoPortal` tipo
 * REPASSES — mesma trilha da arrecadação/despesa/decretos.
 */

type Modo = 'delta' | 'residuo'
type Alvo = { match: string; idPortal: string; modo: Modo; fonte?: string }
type AlvosMunicipio = { portalUrl: string; fonte: string; alvos: Alvo[] }

/**
 * Municípios Elotech com repasses bookados. Fonte segue a convenção de cada um;
 * `fonte` no ALVO sobrepõe a do município — usada nas Câmaras cuja fonte REAL
 * foi provada pela MSC oficial (caixa do poder 20231 em fonte única, script
 * atribuir_fonte_tf_camaras_msc.ts); fundos seguem 9999 (consolidados no po
 * 10131, sem evidência oficial por fundo).
 */
export const ALVOS_REPASSES: Record<string, AlvosMunicipio> = {
  'Maringá': {
    portalUrl: 'https://transparencia.maringa.pr.gov.br/portaltransparencia-api',
    fonte: '1001',
    alvos: [
      { match: 'Câmara do Município', idPortal: '6', modo: 'delta' },
      { match: 'Regulação', idPortal: '9', modo: 'delta' },
      { match: 'IPPLAM', idPortal: '15', modo: 'delta' },
      { match: 'Instituto Ambiental', idPortal: '4', modo: 'delta' },
      { match: 'Maringá Previdência', idPortal: '3', modo: 'residuo' },
    ],
  },
  'Cianorte': {
    portalUrl: 'https://cianorte.oxy.elotech.com.br/portaltransparencia-api',
    fonte: '9999',
    alvos: [
      { match: 'Câmara Municipal de Cianorte', idPortal: '2', modo: 'delta', fonte: '1501' },
      { match: 'CAPSECI', idPortal: '3', modo: 'residuo' },
    ],
  },
  'Naviraí': {
    portalUrl: 'https://navirai.oxy.elotech.com.br/portaltransparencia-api',
    fonte: '9999',
    alvos: [
      { match: 'Câmara Municipal de Naviraí', idPortal: '2', modo: 'delta', fonte: '1500' },
      { match: 'Previdência dos Servidores Públicos de Naviraí', idPortal: '3', modo: 'residuo' },
      { match: 'Fundação de Cultura', idPortal: '4', modo: 'delta' },
      { match: 'Fundo Municipal de Saúde de Naviraí', idPortal: '6', modo: 'delta' },
      { match: 'Assistência Social de Naviraí', idPortal: '7', modo: 'delta' },
      { match: 'Criança e do Adolescente de Naviraí', idPortal: '9', modo: 'delta' },
      { match: 'FUNDEB', idPortal: '11', modo: 'delta' },
      { match: 'Meio Ambiente de Naviraí', idPortal: '12', modo: 'delta' },
      { match: 'Pessoa com Deficiência', idPortal: '13', modo: 'delta' },
      { match: 'Habitação de Interesse Social', idPortal: '14', modo: 'delta' },
      { match: 'Direitos Difusos', idPortal: '15', modo: 'delta' },
      { match: 'Pessoa Idosa', idPortal: '17', modo: 'delta' },
    ],
  },
  'Vilhena': {
    portalUrl: 'https://transparencia.vilhena.ro.gov.br/portaltransparencia-api',
    fonte: '9999',
    alvos: [
      { match: 'Câmara Municipal de Vilhena', idPortal: '14', modo: 'delta', fonte: '1500' },
      { match: 'Instituto de Previdência Municipal de Vilhena', idPortal: '16', modo: 'residuo' },
      { match: 'Fundação Cultural', idPortal: '2', modo: 'delta' },
      { match: 'Fundo Municipal de Saúde de Vilhena', idPortal: '3', modo: 'delta' },
      { match: 'SAAE', idPortal: '25', modo: 'delta' },
      { match: 'Meio Ambiente de Vilhena', idPortal: '26', modo: 'delta' },
      { match: 'Criança e do Adolescente de Vilhena', idPortal: '27', modo: 'delta' },
      { match: 'FUMAPI', idPortal: '28', modo: 'delta' },
      { match: 'FUMAS', idPortal: '29', modo: 'delta' },
    ],
  },
  'Sarandi': {
    portalUrl: 'https://sarandi.eloweb.net/portaltransparencia-api',
    fonte: '9999',
    alvos: [
      { match: 'Câmara Municipal de Sarandi', idPortal: '3', modo: 'delta', fonte: '1501' },
      { match: 'PreSERV', idPortal: '2', modo: 'residuo' },
      { match: 'Águas de Sarandi', idPortal: '4', modo: 'delta' },
    ],
  },
}

const CAIXA = CONTAS_EVENTO.caixaArrecadacao
const VPA = CONTAS_EVENTO.vpaRepasseRecebido
const TOLERANCIA = new Prisma.Decimal('0.01')

export type ResultadoRepasse = {
  entidade: string
  status: 'OK' | 'SEM_DELTA' | 'PULADO' | 'ERRO'
  mensagem: string
  valorGravado: number
}

export class SincronizacaoRepassesService {
  private transferencias: TransferenciasFinanceirasService

  constructor(private prisma: PrismaClient) {
    this.transferencias = new TransferenciasFinanceirasService(prisma)
  }

  /** YTD recebido no portal (Σ valorLancado do /api/repasses?tipo=R). */
  private async portalYtd(portalUrl: string, idPortal: string, ano: number): Promise<Prisma.Decimal> {
    const res = await fetch(`${portalUrl}/api/repasses?tipo=R&mesInicial=01&mesFinal=12`, { headers: { entidade: idPortal, exercicio: String(ano) } })
    if (!res.ok) throw new Error(`portal HTTP ${res.status}`)
    const d = (await res.json()) as { valorLancado?: number }[] | { content?: { valorLancado?: number }[] }
    const rows = Array.isArray(d) ? d : (d.content ?? [])
    return new Prisma.Decimal(rows.reduce((s, r) => s + (r.valorLancado ?? 0), 0).toFixed(2))
  }

  /** Contribuição patronal do ente já lançada como receita orçamentária (1.2.1.5.01 "PREFEITURA/MUNICÍPIO..."). */
  private async patronalArrecadada(entidadeId: string): Promise<Prisma.Decimal> {
    const rows = await this.prisma.previsaoReceita.findMany({
      where: {
        orcamento: { entidadeId },
        contaReceita: { codigo: { startsWith: '1.2.1.5.01' }, OR: [{ descricao: { startsWith: 'PREFEITURA' } }, { descricao: { startsWith: 'MUNICÍPIO' } }, { descricao: { startsWith: 'MUNICIPIO' } }] },
      },
      select: { valorArrecadado: true },
    })
    return rows.reduce((s, p) => s.plus(new Prisma.Decimal(p.valorArrecadado)), new Prisma.Decimal(0))
  }

  /** Re-sincroniza os repasses de UM município (todas as entidades-alvo). */
  async sincronizarMunicipio(municipioNome: string, ano: number, usuarioId: string): Promise<ResultadoRepasse[]> {
    const cfg = ALVOS_REPASSES[municipioNome]
    if (!cfg) return [{ entidade: municipioNome, status: 'PULADO', mensagem: 'Município sem alvos de repasse configurados.', valorGravado: 0 }]
    const out: ResultadoRepasse[] = []
    for (const alvo of cfg.alvos) out.push(await this.sincronizarAlvo(municipioNome, cfg, alvo, ano, usuarioId))
    return out
  }

  private async sincronizarAlvo(municipioNome: string, cfg: AlvosMunicipio, alvo: Alvo, ano: number, usuarioId: string): Promise<ResultadoRepasse> {
    const registrar = async (entidadeId: string | null, r: ResultadoRepasse) => {
      if (entidadeId) {
        await this.prisma.sincronizacaoPortal.create({
          data: {
            entidadeId,
            tipo: 'REPASSES',
            ano,
            mes: new Date().getMonth() + 1,
            status: r.status === 'ERRO' ? 'ERRO' : 'OK',
            mensagem: r.mensagem,
            valorGravado: r.valorGravado.toFixed(2),
          },
        })
      }
      return r
    }
    try {
      const ent = await this.prisma.entidade.findFirst({
        where: { nome: { contains: alvo.match }, municipio: { is: { nome: municipioNome } } },
        select: { id: true, nome: true },
      })
      if (!ent) return { entidade: alvo.match, status: 'PULADO', mensagem: 'Entidade não encontrada no banco.', valorGravado: 0 }

      const portal = await this.portalYtd(cfg.portalUrl, alvo.idPortal, ano)
      // alvo contábil: RPPS desconta a patronal já orçamentária (não duplicar)
      const meta = alvo.modo === 'residuo' ? portal.minus(await this.patronalArrecadada(ent.id)) : portal
      const tfs = await this.prisma.transferenciaFinanceira.findMany({ where: { entidadeId: ent.id, tipo: 'RECEBIDA' }, select: { valor: true } })
      const booked = tfs.reduce((s, t) => s.plus(new Prisma.Decimal(t.valor)), new Prisma.Decimal(0))
      const delta = meta.minus(booked)
      if (delta.lte(TOLERANCIA)) {
        return registrar(ent.id, { entidade: ent.nome, status: 'SEM_DELTA', mensagem: `Em dia (portal ${portal.toFixed(2)}, alvo ${meta.toFixed(2)}, lançado ${booked.toFixed(2)}).`, valorGravado: 0 })
      }

      // pré-validação contábil (caixa/VPA [MOV] + fonte) — aborta claro se faltar
      const fonte = alvo.fonte ?? cfg.fonte
      const contas = new Map(
        (await this.prisma.contaContabilEntidade.findMany({ where: { entidadeId: ent.id, ano, codigo: { in: [CAIXA, VPA] } }, select: { codigo: true, admiteMovimento: true } })).map((c) => [c.codigo, c.admiteMovimento]),
      )
      const temFonte = await this.prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId: ent.id, ano, codigo: fonte }, select: { id: true } })
      if (contas.get(CAIXA) !== true || contas.get(VPA) !== true || !temFonte) {
        return registrar(ent.id, { entidade: ent.nome, status: 'ERRO', mensagem: `Sem caixa/VPA [MOV] ou fonte ${fonte} — repasse não lançado.`, valorGravado: 0 })
      }

      // idempotência por (entidade, data): 1 ajuste por dia no máximo
      const hoje = new Date().toISOString().slice(0, 10)
      const jaHoje = await this.prisma.transferenciaFinanceira.findFirst({ where: { entidadeId: ent.id, data: new Date(hoje) }, select: { id: true } })
      if (jaHoje) {
        return registrar(ent.id, { entidade: ent.nome, status: 'SEM_DELTA', mensagem: `Já há ajuste lançado hoje (${hoje}) — delta ${delta.toFixed(2)} fica para a próxima execução.`, valorGravado: 0 })
      }

      await this.transferencias.registrar({
        entidadeId: ent.id,
        data: hoje,
        valor: delta.toFixed(2),
        fonteCodigo: fonte,
        historico: `Ajuste do repasse recebido ao YTD do portal (re-sincronização ${hoje})`,
        criadoPorId: usuarioId,
      })
      // ESPELHO no Executivo (evento 901): sem ele o caixa da prefeitura fica
      // superavaliado exatamente no valor do repasse. Falha do espelho não desfaz
      // a recebida — loga ERRO p/ correção (o backfill espelhar_tf_concedidas repara).
      const espelho = await this.bookarEspelhoConcedido(municipioNome, ent.nome, hoje, delta.toFixed(2), fonte, ano, usuarioId)
      return registrar(ent.id, {
        entidade: ent.nome,
        status: 'OK',
        mensagem: `Delta lançado: ${delta.toFixed(2)} (portal ${portal.toFixed(2)}, alvo ${meta.toFixed(2)}); espelho concedido: ${espelho}.`,
        valorGravado: Number(delta),
      })
    } catch (e) {
      return { entidade: alvo.match, status: 'ERRO', mensagem: e instanceof Error ? e.message : String(e), valorGravado: 0 }
    }
  }

  /**
   * Booka a TF CONCEDIDA (evento 901) na Prefeitura do município — espelho 1:1 do
   * delta recebido. Retorna um resumo p/ o log; não lança (a recebida já está
   * gravada; divergência fica visível e o backfill repara).
   */
  private async bookarEspelhoConcedido(
    municipioNome: string,
    destino: string,
    data: string,
    valor: string,
    fonte: string,
    ano: number,
    usuarioId: string,
  ): Promise<string> {
    try {
      const pref = await this.prisma.entidade.findFirst({
        where: { nome: { contains: 'Prefeitura' }, municipio: { is: { nome: municipioNome } } },
        select: { id: true },
      })
      if (!pref) return 'SEM PREFEITURA no município'
      const temFonte = await this.prisma.fonteRecursoEntidade.findFirst({ where: { entidadeId: pref.id, ano, codigo: fonte }, select: { id: true } })
      if (!temFonte) return `prefeitura sem fonte ${fonte}`
      await this.transferencias.registrar({
        entidadeId: pref.id,
        tipo: 'CONCEDIDA',
        data,
        valor,
        fonteCodigo: fonte,
        historico: `Espelho: repasse concedido a ${destino} (re-sincronização ${data})`,
        criadoPorId: usuarioId,
      })
      return `OK (${valor})`
    } catch (e) {
      return `ERRO: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}
