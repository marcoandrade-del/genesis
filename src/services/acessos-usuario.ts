import { PrismaClient, type NivelAcessoEntidade } from '@prisma/client'
import { AcessosEntidadeService } from './acessos-entidade.js'

export type MunicipioAcesso = {
  id: string
  nome: string
  estado: string
  nivel: NivelAcessoEntidade
}

/**
 * Municípios que um usuário pode ver no BI (OXY Dashboards), via `AcessoEntidade`
 * sobre a **PREFEITURA** (o BI mostra o dado da prefeitura do município). Reusa
 * `AcessosEntidadeService.listarPorUsuario` (já traz entidade→município→estado e
 * filtra ativos) e filtra `tipo=PREFEITURA`. Read-only; nenhuma tabela nova.
 *
 * É a fonte da lista de municípios permitidos que o oxy-bi-jpa (BFF) usa para
 * montar o claim `clientes_permitidos` do JWT de sessão e filtrar o catálogo.
 */
export class AcessosUsuarioService {
  private readonly acessos: AcessosEntidadeService

  constructor(private prisma: PrismaClient) {
    this.acessos = new AcessosEntidadeService(prisma)
  }

  /** `null` = e-mail não encontrado (o endpoint devolve 404). */
  async municipiosPermitidos(email: string): Promise<{ email: string; municipios: MunicipioAcesso[] } | null> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { emailPrincipal: email },
      select: { id: true },
    })
    if (!usuario) return null

    const acessos = await this.acessos.listarPorUsuario(usuario.id)
    const municipios = acessos
      .filter((a) => a.entidade.tipo === 'PREFEITURA')
      .map((a) => ({
        id: a.entidade.municipio.id,
        nome: a.entidade.municipio.nome,
        estado: a.entidade.municipio.estado.sigla,
        nivel: a.nivel,
      }))
    return { email, municipios }
  }
}
