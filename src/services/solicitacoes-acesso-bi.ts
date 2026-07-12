import { PrismaClient } from '@prisma/client'
import { SolicitacoesAcessoService } from './solicitacoes-acesso.js'
import { AcessosEntidadeService } from './acessos-entidade.js'
import { ErroNegocio } from '../errors.js'

export type MunicipioRef = { id: string; nome: string; estado: string }

export type SolicitacaoAcessoBi = {
  id: string
  status: string
  nivelSolicitado: string
  justificativa: string | null
  criadoEm: Date
  municipio: MunicipioRef
}

/** Pendente vista pelo ADMIN: acrescenta quem pediu (o admin decide sabendo o solicitante). */
export type SolicitacaoAcessoBiPendente = SolicitacaoAcessoBi & {
  solicitante: { nome: string; email: string }
}

/**
 * Ponte do BI (OXY Dashboards) para as solicitações de acesso: identifica o usuário por
 * E-MAIL e o município por UUID — o oxy-bi-jpa é o BFF, autenticado por token de SERVIÇO
 * (a identidade do usuário vem no corpo/query, não em JWT de usuário). Resolve o município
 * → PREFEITURA e reusa a regra de `SolicitacoesAcessoService`.
 *
 * Dois lados: o do USUÁRIO (solicitar/listar/cancelar as próprias) e o do ADMIN do município
 * (listar pendentes / aprovar / rejeitar). A barreira real da aprovação é aqui:
 * `exigirAdmin` confere no Gênesis que o e-mail do aprovador é ADMIN da prefeitura — o BFF
 * já gateia por `clientes_admin`, mas a decisão nunca confia só no chamador.
 */
export class SolicitacoesAcessoBiService {
  private readonly solicitacoes: SolicitacoesAcessoService
  private readonly acessos: AcessosEntidadeService

  constructor(private prisma: PrismaClient) {
    this.solicitacoes = new SolicitacoesAcessoService(prisma)
    this.acessos = new AcessosEntidadeService(prisma)
  }

  /** Barreira da aprovação: o aprovador precisa ser ADMIN da entidade (senão 403). */
  private async exigirAdmin(aprovadorId: string, entidadeId: string): Promise<void> {
    const admin = await this.acessos.usuarioPodeAcessar(aprovadorId, entidadeId, 'ADMIN')
    if (!admin) {
      throw new ErroNegocio('NAO_AUTORIZADO', 'Ação restrita ao administrador do município.')
    }
  }

  private async usuarioId(email: string): Promise<string> {
    const u = await this.prisma.usuario.findUnique({
      where: { emailPrincipal: email.trim() },
      select: { id: true },
    })
    if (!u) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
    return u.id
  }

  private async prefeitura(municipioId: string): Promise<{ entidadeId: string; municipio: MunicipioRef }> {
    const e = await this.prisma.entidade.findFirst({
      where: { municipioId: municipioId.trim(), tipo: 'PREFEITURA', ativo: true },
      select: { id: true, municipio: { select: { id: true, nome: true, estado: { select: { sigla: true } } } } },
    })
    if (!e) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Município sem prefeitura ativa.')
    return { entidadeId: e.id, municipio: { id: e.municipio.id, nome: e.municipio.nome, estado: e.municipio.estado.sigla } }
  }

  /** Usuário solicita acesso (nível LEITURA — o BI só exibe) à prefeitura de um município. */
  async solicitar(email: string, municipioId: string, justificativa?: string): Promise<SolicitacaoAcessoBi> {
    const usuarioId = await this.usuarioId(email)
    const { entidadeId, municipio } = await this.prefeitura(municipioId)
    const sol = await this.solicitacoes.criar({ usuarioId, entidadeId, nivelSolicitado: 'LEITURA', justificativa })
    return {
      id: sol.id,
      status: sol.status,
      nivelSolicitado: sol.nivelSolicitado,
      justificativa: sol.justificativa,
      criadoEm: sol.criadoEm,
      municipio,
    }
  }

  /** Solicitações do próprio usuário (só as de PREFEITURA — é o que o BI mostra), recentes primeiro. */
  async listar(email: string): Promise<SolicitacaoAcessoBi[]> {
    const usuarioId = await this.usuarioId(email)
    const lista = await this.solicitacoes.listarMinhas(usuarioId)
    return lista
      .filter((s) => s.entidade.tipo === 'PREFEITURA')
      .map((s) => ({
        id: s.id,
        status: s.status,
        nivelSolicitado: s.nivelSolicitado,
        justificativa: s.justificativa,
        criadoEm: s.criadoEm,
        municipio: { id: s.entidade.municipio.id, nome: s.entidade.municipio.nome, estado: s.entidade.municipio.estado.sigla },
      }))
  }

  /** Usuário cancela a própria solicitação pendente. */
  async cancelar(email: string, id: string): Promise<{ id: string; status: string }> {
    const usuarioId = await this.usuarioId(email)
    const sol = await this.solicitacoes.cancelar(id, usuarioId)
    return { id: sol.id, status: sol.status }
  }

  /** ADMIN do município: solicitações PENDENTES da prefeitura (com o solicitante). */
  async listarPendentes(email: string, municipioId: string): Promise<SolicitacaoAcessoBiPendente[]> {
    const aprovadorId = await this.usuarioId(email)
    const { entidadeId, municipio } = await this.prefeitura(municipioId)
    await this.exigirAdmin(aprovadorId, entidadeId)
    const lista = await this.solicitacoes.listarPendentesDaEntidade(entidadeId)
    return lista.map((s) => ({
      id: s.id,
      status: s.status,
      nivelSolicitado: s.nivelSolicitado,
      justificativa: s.justificativa,
      criadoEm: s.criadoEm,
      municipio,
      solicitante: { nome: s.usuario.nomeCompleto, email: s.usuario.emailPrincipal },
    }))
  }

  /** ADMIN aprova: concede o nível SOLICITADO e cria/ativa o acesso (escopo = prefeitura). */
  async aprovar(email: string, municipioId: string, id: string): Promise<{ id: string; status: string }> {
    const aprovadorId = await this.usuarioId(email)
    const { entidadeId } = await this.prefeitura(municipioId)
    await this.exigirAdmin(aprovadorId, entidadeId)
    const sol = await this.prisma.solicitacaoAcessoEntidade.findUnique({
      where: { id },
      select: { nivelSolicitado: true },
    })
    if (!sol) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Solicitação não encontrada.')
    const atualizada = await this.solicitacoes.aprovar(id, aprovadorId, sol.nivelSolicitado, undefined, entidadeId)
    return { id: atualizada.id, status: atualizada.status }
  }

  /** ADMIN rejeita a solicitação pendente (escopo = prefeitura do município). */
  async rejeitar(email: string, municipioId: string, id: string): Promise<{ id: string; status: string }> {
    const aprovadorId = await this.usuarioId(email)
    const { entidadeId } = await this.prefeitura(municipioId)
    await this.exigirAdmin(aprovadorId, entidadeId)
    const atualizada = await this.solicitacoes.rejeitar(id, aprovadorId, undefined, entidadeId)
    return { id: atualizada.id, status: atualizada.status }
  }
}
