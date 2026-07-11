import { PrismaClient } from '@prisma/client'
import { SolicitacoesAcessoService } from './solicitacoes-acesso.js'
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

/**
 * Ponte do BI (OXY Dashboards) para as solicitações de acesso: identifica o usuário por
 * E-MAIL e o município por UUID — o oxy-bi-jpa é o BFF, autenticado por token de SERVIÇO
 * (a identidade do usuário vem no corpo/query, não em JWT de usuário). Resolve o município
 * → PREFEITURA e reusa a regra de `SolicitacoesAcessoService`. Só as solicitações do próprio
 * usuário; a APROVAÇÃO/REJEIÇÃO segue no admin do Gênesis (esta ponte não decide).
 */
export class SolicitacoesAcessoBiService {
  private readonly solicitacoes: SolicitacoesAcessoService

  constructor(private prisma: PrismaClient) {
    this.solicitacoes = new SolicitacoesAcessoService(prisma)
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
}
