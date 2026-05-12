import { PrismaClient, Prisma } from '@prisma/client'
import { hash, verify } from 'argon2'
import { ErroNegocio } from '../errors.js'

function validarCpf(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const calc = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(d[i] ?? '0') * (n + 1 - i)
    const r = 11 - (s % 11)
    return r >= 10 ? 0 : r
  }
  return calc(9) === Number(d[9] ?? '') && calc(10) === Number(d[10] ?? '')
}

type RegistrarDados = {
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
}

// Campos retornados em respostas — senhaHash nunca é exposto
export const camposPublicos = {
  id: true,
  cpf: true,
  idEstrangeiro: true,
  nomeCompleto: true,
  nomeSocial: true,
  dataNascimento: true,
  emailPrincipal: true,
  emailAlternativo: true,
  telefonePrincipal: true,
  telefoneAlternativo: true,
  emailValidado: true,
  celularValidado: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
} as const

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async registrar(dados: RegistrarDados) {
    if (!dados.cpf && !dados.idEstrangeiro) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe CPF (brasileiro) ou ID estrangeiro.')
    }
    if (dados.cpf && dados.idEstrangeiro) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe CPF ou ID estrangeiro, não ambos.')
    }
    if (dados.cpf && !validarCpf(dados.cpf)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'CPF inválido.')
    }
    if (dados.senha.length < 8) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', 'A senha deve ter pelo menos 8 caracteres.')
    }

    const { senha, ...dadosUsuario } = dados
    const senhaHash = await hash(senha)

    try {
      return await this.prisma.usuario.create({
        data: { ...dadosUsuario, dataNascimento: new Date(dadosUsuario.dataNascimento), senhaHash },
        select: camposPublicos,
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const t = (e.meta?.['target'] as string[] | undefined) ?? []
        if (t.includes('cpf')) throw new ErroNegocio('CONFLITO', 'Já existe um usuário com este CPF.')
        if (t.some(f => f.includes('estrangeiro'))) throw new ErroNegocio('CONFLITO', 'Já existe um usuário com este ID estrangeiro.')
        if (t.some(f => f.includes('email'))) throw new ErroNegocio('CONFLITO', 'Já existe um usuário com este e-mail.')
        throw new ErroNegocio('CONFLITO', 'Dado duplicado.')
      }
      throw e
    }
  }

  async login(email: string, senha: string) {
    // Busca sem select para ter acesso a senhaHash (nunca retornado ao cliente)
    const usuario = await this.prisma.usuario.findUnique({
      where: { emailPrincipal: email },
      select: { id: true, emailPrincipal: true, senhaHash: true, emailValidado: true, ativo: true },
    })

    // Mesma mensagem para email e senha — não revelar qual está errado
    const erroCredenciais = new ErroNegocio('REQUISICAO_INVALIDA', 'E-mail ou senha incorretos.')
    if (!usuario?.senhaHash) throw erroCredenciais

    const senhaCorreta = await verify(usuario.senhaHash, senha)
    if (!senhaCorreta) throw erroCredenciais

    if (!usuario.emailValidado) {
      throw new ErroNegocio('CONFLITO', 'E-mail não validado. Confirme seu e-mail antes de acessar.')
    }
    if (!usuario.ativo) {
      throw new ErroNegocio('CONFLITO', 'Conta não ativada. Valide seu celular para continuar.')
    }

    return { sub: usuario.id, email: usuario.emailPrincipal }
  }
}
