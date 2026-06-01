import { PrismaClient } from '@prisma/client'

/**
 * Função e Subfunção da Portaria MOG nº 42/1999 — tabela de referência fixa
 * (lei federal). Só leitura: a lista é fechada e populada por migration.
 */
export class FuncoesService {
  constructor(private prisma: PrismaClient) {}

  /** Lista todas as funções ordenadas por código, com subfunções carregadas. */
  listar() {
    return this.prisma.funcao.findMany({
      orderBy: { codigo: 'asc' },
      include: { subfuncoes: { orderBy: { codigo: 'asc' } } },
    })
  }

  buscarPorId(id: string) {
    return this.prisma.funcao.findUnique({
      where: { id },
      include: { subfuncoes: { orderBy: { codigo: 'asc' } } },
    })
  }

  /** Lista todas as subfunções (~111 itens) ordenadas por código.
   * Inclui a função pai para exibição. */
  listarSubfuncoes() {
    return this.prisma.subfuncao.findMany({
      orderBy: { codigo: 'asc' },
      include: { funcao: { select: { codigo: true, nome: true } } },
    })
  }
}
