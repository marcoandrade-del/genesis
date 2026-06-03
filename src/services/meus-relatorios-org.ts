import { PrismaClient } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

const NOME_MAX = 80

type RelatorioNo = { id: string; nome: string; descricao: string | null; cabecalhoId: string | null; rodapeId: string | null }
type PastaNo = { id: string; nome: string; filhos: PastaNo[]; relatorios: RelatorioNo[] }

function normNome(nome: unknown): string {
  const v = typeof nome === 'string' ? nome.trim() : ''
  if (!v) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe o nome da pasta.')
  if (v.length > NOME_MAX) throw new ErroNegocio('REQUISICAO_INVALIDA', `Nome muito longo (máx. ${NOME_MAX}).`)
  return v
}

function normId(id: unknown): string | null {
  const v = typeof id === 'string' ? id.trim() : ''
  return v ? v : null
}

/**
 * Organização de "Meus Relatórios" em pastas aninhadas, por usuário + entidade.
 * Reusa PastaFavorito (a pasta) e FavoritoRelatorio (o vínculo relatório→pasta).
 * Um relatório fica em no máximo uma pasta; sem vínculo = "Sem pasta".
 */
export class MeusRelatoriosOrgService {
  constructor(private prisma: PrismaClient) {}

  /** Árvore de pastas (raízes) + lista de relatórios sem pasta. */
  async arvore(usuarioId: string, entidadeId: string): Promise<{ raizes: PastaNo[]; semPasta: RelatorioNo[] }> {
    const [pastas, relatorios, vinculos] = await Promise.all([
      this.prisma.pastaFavorito.findMany({
        where: { usuarioId, entidadeId },
        orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      }),
      this.prisma.relatorioPersonalizado.findMany({
        where: { usuarioId, entidadeId },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true, descricao: true, cabecalhoId: true, rodapeId: true },
      }),
      this.prisma.favoritoRelatorio.findMany({
        where: { usuarioId, relatorioPersonalizadoId: { not: null } },
        select: { pastaId: true, relatorioPersonalizadoId: true },
      }),
    ])

    const pastaDoRelatorio = new Map<string, string | null>()
    for (const v of vinculos) if (v.relatorioPersonalizadoId) pastaDoRelatorio.set(v.relatorioPersonalizadoId, v.pastaId)

    const nos = new Map<string, PastaNo>()
    for (const p of pastas) nos.set(p.id, { id: p.id, nome: p.nome, filhos: [], relatorios: [] })

    const raizes: PastaNo[] = []
    for (const p of pastas) {
      const no = nos.get(p.id)!
      const pai = p.parentId ? nos.get(p.parentId) : undefined
      if (pai) pai.filhos.push(no)
      else raizes.push(no)
    }

    const semPasta: RelatorioNo[] = []
    for (const r of relatorios) {
      const pastaId = pastaDoRelatorio.get(r.id)
      const no = pastaId ? nos.get(pastaId) : undefined
      if (no) no.relatorios.push(r)
      else semPasta.push(r)
    }

    return { raizes, semPasta }
  }

  /** Lista plana das pastas (para selects de "mover para"). */
  listarPastas(usuarioId: string, entidadeId: string) {
    return this.prisma.pastaFavorito.findMany({
      where: { usuarioId, entidadeId },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true },
    })
  }

  private async garantirPasta(id: string, usuarioId: string, entidadeId: string) {
    const p = await this.prisma.pastaFavorito.findUnique({ where: { id } })
    if (!p || p.usuarioId !== usuarioId || p.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Pasta não encontrada.')
    }
    return p
  }

  async criarPasta(usuarioId: string, entidadeId: string, dados: { nome?: unknown; parentId?: unknown }) {
    const nome = normNome(dados.nome)
    const parentId = normId(dados.parentId)
    if (parentId) await this.garantirPasta(parentId, usuarioId, entidadeId)
    return this.prisma.pastaFavorito.create({ data: { usuarioId, entidadeId, nome, parentId } })
  }

  async renomearPasta(id: string, usuarioId: string, entidadeId: string, nome: unknown) {
    await this.garantirPasta(id, usuarioId, entidadeId)
    return this.prisma.pastaFavorito.update({ where: { id }, data: { nome: normNome(nome) } })
  }

  async excluirPasta(id: string, usuarioId: string, entidadeId: string) {
    await this.garantirPasta(id, usuarioId, entidadeId)
    const subpastas = await this.prisma.pastaFavorito.count({ where: { parentId: id } })
    if (subpastas > 0) throw new ErroNegocio('CONFLITO', 'Esvazie as subpastas antes de excluir.')
    const itens = await this.prisma.favoritoRelatorio.count({ where: { pastaId: id } })
    if (itens > 0) throw new ErroNegocio('CONFLITO', 'Mova os relatórios para fora antes de excluir a pasta.')
    return this.prisma.pastaFavorito.delete({ where: { id } })
  }

  /** Coloca um relatório numa pasta (ou tira de qualquer pasta, com pastaId null). */
  async atribuirRelatorio(relatorioId: string, usuarioId: string, entidadeId: string, pastaIdBruto: unknown) {
    const rel = await this.prisma.relatorioPersonalizado.findUnique({ where: { id: relatorioId } })
    if (!rel || rel.usuarioId !== usuarioId || rel.entidadeId !== entidadeId) {
      throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Relatório não encontrado.')
    }
    const pastaId = normId(pastaIdBruto)
    if (pastaId) await this.garantirPasta(pastaId, usuarioId, entidadeId)

    const existente = await this.prisma.favoritoRelatorio.findFirst({
      where: { usuarioId, relatorioPersonalizadoId: relatorioId },
    })

    if (!pastaId) {
      // Sem pasta: remove o vínculo se houver.
      if (existente) await this.prisma.favoritoRelatorio.delete({ where: { id: existente.id } })
      return null
    }
    if (existente) {
      return this.prisma.favoritoRelatorio.update({ where: { id: existente.id }, data: { pastaId } })
    }
    return this.prisma.favoritoRelatorio.create({ data: { usuarioId, relatorioPersonalizadoId: relatorioId, pastaId } })
  }
}
