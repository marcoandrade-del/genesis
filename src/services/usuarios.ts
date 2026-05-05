import { PrismaClient, Prisma } from '@prisma/client'
import { hash } from 'argon2'
import { ErroNegocio } from '../errors.js'
import { AuthService, camposPublicos } from './auth.js'

type CriarDados = {
  cpf?: string
  idEstrangeiro?: string
  nomeCompleto: string
  nomeSocial: string
  dataNascimento: string
  emailPrincipal: string
  emailAlternativo?: string
  telefonePrincipal: string
  telefoneAlternativo?: string
  senha: string
  ativo?: boolean
}

type AtualizarDados = {
  nomeCompleto?: string
  nomeSocial?: string
  dataNascimento?: string
  emailAlternativo?: string
  telefonePrincipal?: string
  telefoneAlternativo?: string
  ativo?: boolean
  senha?: string
}

export class UsuariosService {
  constructor(private prisma: PrismaClient) {}

  async criar(dados: CriarDados) {
    const { ativo, ...registrarDados } = dados
    const authSvc = new AuthService(this.prisma)
    const usuario = await authSvc.registrar(registrarDados)
    if (ativo !== undefined) {
      return this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { ativo },
        select: camposPublicos,
      })
    }
    return usuario
  }

  listar() {
    return this.prisma.usuario.findMany({
      select: camposPublicos,
      orderBy: { nomeCompleto: 'asc' },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.usuario.findUnique({ where: { id }, select: camposPublicos })
  }

  async atualizar(id: string, dados: AtualizarDados) {
    const { dataNascimento, senha, nomeCompleto, ...resto } = dados

    if (nomeCompleto !== undefined && !nomeCompleto.trim())
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Nome completo não pode ser vazio.')

    let senhaHash: string | undefined
    if (senha) {
      if (senha.length < 8) throw new ErroNegocio('REQUISICAO_INVALIDA', 'A senha deve ter pelo menos 8 caracteres.')
      senhaHash = await hash(senha)
    }

    let dataNascimentoDate: Date | undefined
    if (dataNascimento !== undefined) {
      dataNascimentoDate = new Date(dataNascimento)
      if (isNaN(dataNascimentoDate.getTime()))
        throw new ErroNegocio('REQUISICAO_INVALIDA', 'Data de nascimento inválida.')
    }

    try {
      return await this.prisma.usuario.update({
        where: { id },
        select: camposPublicos,
        data: {
          ...(nomeCompleto !== undefined ? { nomeCompleto } : {}),
          ...resto,
          ...(dataNascimentoDate !== undefined ? { dataNascimento: dataNascimentoDate } : {}),
          ...(senhaHash !== undefined ? { senhaHash } : {}),
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')
      }
      throw e
    }
  }

  async excluir(id: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } })
    if (!usuario) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Usuário não encontrado.')

    const [admSistemas, admModulos, permissoes, relatorios, pastas, favoritos] =
      await Promise.all([
        this.prisma.adminSistema.count({ where: { usuarioId: id } }),
        this.prisma.adminModulo.count({ where: { usuarioId: id } }),
        this.prisma.permissaoAcesso.count({ where: { usuarioId: id } }),
        this.prisma.relatorioPersonalizado.count({ where: { usuarioId: id } }),
        this.prisma.pastaFavorito.count({ where: { usuarioId: id } }),
        this.prisma.favoritoRelatorio.count({ where: { usuarioId: id } }),
      ] as const)

    if (admSistemas > 0) throw new ErroNegocio('CONFLITO', 'Usuário é administrador de um ou mais sistemas.')
    if (admModulos > 0) throw new ErroNegocio('CONFLITO', 'Usuário é administrador de um ou mais módulos.')
    if (permissoes > 0) throw new ErroNegocio('CONFLITO', 'Usuário possui permissões de acesso vinculadas.')
    if (relatorios > 0) throw new ErroNegocio('CONFLITO', 'Usuário possui relatórios personalizados vinculados.')
    if (pastas > 0) throw new ErroNegocio('CONFLITO', 'Usuário possui pastas de favoritos vinculadas.')
    if (favoritos > 0) throw new ErroNegocio('CONFLITO', 'Usuário possui favoritos vinculados.')

    return this.prisma.usuario.delete({ where: { id } })
  }
}
