import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'
import { parseComposicao } from './rcl.js'
import { parseClassificacaoFonte } from './fonte-classificacao.js'
import { parsePessoal } from './despesa-pessoal.js'

/** null → limpa o override (DbNull); objeto → grava o JSON. */
function comoJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue)
}

const incluiProponente = {
  usuario: { select: { id: true, nomeCompleto: true, emailPrincipal: true } },
  estado: { select: { id: true, sigla: true, nome: true } },
} as const

/**
 * SolicitacaoMemorial: proposta de um usuário (poder específico da bancada) para
 * alterar os memoriais de cálculo de um Estado (RCL, fonte→finalidade, Despesa
 * com Pessoal), testada ao vivo contra um município. Espelha
 * `SolicitacoesAcessoService`: o usuário PROPÕE (snapshot dos 3 JSON) e o ADMIN
 * do sistema APROVA → grava o override nos campos JSON do `Estado`, na mesma
 * transação. Regra "no máx. 1 PENDENTE por (usuário, estado)" é garantida aqui.
 * READ-ONLY até aprovar; a bancada nunca grava. Ver [[contabil-rcl-lrf-plano]].
 */
export class SolicitacoesMemorialService {
  constructor(private prisma: PrismaClient) {}

  /** Usuário propõe. Valida os 3 JSON (inválido → erro), barra pendência duplicada por (usuário, estado). */
  async criar(dados: {
    usuarioId: string
    estadoId: string
    entidadePreviewId?: string | null
    ano?: number | null
    rcl?: unknown
    fonte?: unknown
    pessoal?: unknown
    justificativa?: string
  }) {
    const usuarioId = dados.usuarioId?.trim() ?? ''
    const estadoId = dados.estadoId?.trim() ?? ''
    if (!usuarioId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'usuarioId é obrigatório.')
    if (!estadoId) throw new ErroNegocio('REQUISICAO_INVALIDA', 'estadoId é obrigatório.')

    // Valida/normaliza cada memorial: presente e inválido → erro; ausente → null.
    const rcl = dados.rcl == null ? null : parseComposicao(dados.rcl)
    if (dados.rcl != null && !rcl) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Composição da RCL inválida.')
    const fonte = dados.fonte == null ? null : parseClassificacaoFonte(dados.fonte)
    if (dados.fonte != null && !fonte) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Classificação de fonte inválida.')
    const pessoal = dados.pessoal == null ? null : parsePessoal(dados.pessoal)
    if (dados.pessoal != null && !pessoal) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Composição de pessoal inválida.')
    if (!rcl && !fonte && !pessoal) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nenhum memorial informado na proposta.')
    }

    const estado = await this.prisma.estado.findUnique({ where: { id: estadoId }, select: { id: true } })
    if (!estado) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Estado não encontrado.')

    const pendente = await this.prisma.solicitacaoMemorial.findFirst({
      where: { usuarioId, estadoId, status: 'PENDENTE' },
    })
    if (pendente) {
      throw new ErroNegocio('CONFLITO', 'Você já tem uma proposta pendente para este estado.')
    }

    return this.prisma.solicitacaoMemorial.create({
      data: {
        usuarioId,
        estadoId,
        entidadePreviewId: dados.entidadePreviewId?.trim() || null,
        ano: dados.ano ?? null,
        rclComposicao: comoJson(rcl),
        fonteClassificacao: comoJson(fonte),
        pessoalComposicao: comoJson(pessoal),
        justificativa: dados.justificativa?.trim() || null,
      },
    })
  }

  /** Propostas do próprio usuário (mais recentes primeiro). */
  listarMinhas(usuarioId: string) {
    return this.prisma.solicitacaoMemorial.findMany({
      where: { usuarioId },
      include: { estado: { select: { id: true, sigla: true, nome: true } } },
      orderBy: { criadoEm: 'desc' },
    })
  }

  /** Fila de pendentes (admin do sistema vê todas). */
  listarPendentes() {
    return this.prisma.solicitacaoMemorial.findMany({
      where: { status: 'PENDENTE' },
      include: incluiProponente,
      orderBy: { criadoEm: 'asc' },
    })
  }

  /** Usuário cancela a própria proposta pendente. */
  async cancelar(id: string, usuarioId: string) {
    const sol = await this.prisma.solicitacaoMemorial.findUnique({ where: { id } })
    if (!sol || sol.usuarioId !== usuarioId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Proposta não encontrada.')
    }
    if (sol.status !== 'PENDENTE') {
      throw new ErroNegocio('CONFLITO', 'Só é possível cancelar uma proposta pendente.')
    }
    return this.prisma.solicitacaoMemorial.update({ where: { id }, data: { status: 'CANCELADA' } })
  }

  /**
   * Aprova a proposta, na mesma transação, conforme o `modo` escolhido pelo admin
   * (só os memoriais PRESENTES no snapshot são gravados; ausentes ficam intactos):
   *  - `ESPECIFICO_ESTADO` (padrão): grava o override nos campos JSON do `Estado`.
   *  - `ALTERAR_MODELO`: grava no `ModeloContabil` do estado (COMPARTILHADO → aflora
   *    para todos que o usam) e LIMPA o override do Estado, para o valor do modelo
   *    aflorar via o resolver de 3 níveis (Estado > Modelo > default).
   */
  async aprovar(
    id: string,
    aprovadorId: string,
    opts: { modo?: 'ESPECIFICO_ESTADO' | 'ALTERAR_MODELO'; observacao?: string } = {},
  ) {
    const modo = opts.modo === 'ALTERAR_MODELO' ? 'ALTERAR_MODELO' : 'ESPECIFICO_ESTADO'
    const sol = await this.prisma.solicitacaoMemorial.findUnique({ where: { id } })
    if (!sol) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Proposta não encontrada.')
    if (sol.status !== 'PENDENTE') throw new ErroNegocio('CONFLITO', 'Proposta já foi decidida.')
    const val = (v: unknown) => v as Prisma.InputJsonValue

    return this.prisma.$transaction(async (tx) => {
      if (modo === 'ALTERAR_MODELO') {
        const est = await tx.estado.findUnique({ where: { id: sol.estadoId }, select: { modeloContabilId: true } })
        if (!est?.modeloContabilId) {
          throw new ErroNegocio('CONFLITO', 'Estado sem modelo contábil vinculado — use “específico do estado”.')
        }
        const dataModelo: Prisma.ModeloContabilUpdateInput = {}
        const dataEstado: Prisma.EstadoUpdateInput = {}
        if (sol.rclComposicao != null) { dataModelo.rclComposicao = val(sol.rclComposicao); dataEstado.rclComposicao = Prisma.DbNull }
        if (sol.fonteClassificacao != null) { dataModelo.fonteClassificacao = val(sol.fonteClassificacao); dataEstado.fonteClassificacao = Prisma.DbNull }
        if (sol.pessoalComposicao != null) { dataModelo.pessoalComposicao = val(sol.pessoalComposicao); dataEstado.pessoalComposicao = Prisma.DbNull }
        await tx.modeloContabil.update({ where: { id: est.modeloContabilId }, data: dataModelo })
        await tx.estado.update({ where: { id: sol.estadoId }, data: dataEstado })
      } else {
        const dataEstado: Prisma.EstadoUpdateInput = {}
        if (sol.rclComposicao != null) dataEstado.rclComposicao = val(sol.rclComposicao)
        if (sol.fonteClassificacao != null) dataEstado.fonteClassificacao = val(sol.fonteClassificacao)
        if (sol.pessoalComposicao != null) dataEstado.pessoalComposicao = val(sol.pessoalComposicao)
        await tx.estado.update({ where: { id: sol.estadoId }, data: dataEstado })
      }
      return tx.solicitacaoMemorial.update({
        where: { id },
        data: {
          status: 'APROVADA',
          decididoPorId: aprovadorId,
          decididoEm: new Date(),
          observacaoDecisao: opts.observacao?.trim() || null,
        },
      })
    })
  }

  /** Rejeita a proposta pendente (não grava no Estado). */
  async rejeitar(id: string, aprovadorId: string, observacao?: string) {
    const sol = await this.prisma.solicitacaoMemorial.findUnique({ where: { id } })
    if (!sol) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Proposta não encontrada.')
    if (sol.status !== 'PENDENTE') throw new ErroNegocio('CONFLITO', 'Proposta já foi decidida.')
    return this.prisma.solicitacaoMemorial.update({
      where: { id },
      data: {
        status: 'REJEITADA',
        decididoPorId: aprovadorId,
        decididoEm: new Date(),
        observacaoDecisao: observacao?.trim() || null,
      },
    })
  }
}
