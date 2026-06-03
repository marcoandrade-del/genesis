import type { FastifyInstance } from 'fastify'
import { AcessosEntidadeService } from '../services/acessos-entidade.js'

const ANO_CORRENTE = new Date().getUTCFullYear()
// Faixa de anos oferecida no seletor: corrente + 5 anteriores + 1 seguinte
// (suficiente para o caso comum de "voltar para refazer lançamento de anos
// passados"). Sistema tolera 1900..9999 — a UI só restringe a faixa visual.
const ANOS_OFERECIDOS = (() => {
  const lista: number[] = []
  for (let a = ANO_CORRENTE + 1; a >= ANO_CORRENTE - 5; a--) lista.push(a)
  return lista
})()

const COOKIE_EXERCICIO = 'genesis_exercicio'

export function parseContextoCookie(valor: string | undefined): {
  entidadeId: string
  ano: number
} | null {
  if (!valor) return null
  const [entidadeId, anoStr] = valor.split(':')
  if (!entidadeId || !anoStr) return null
  const ano = parseInt(anoStr, 10)
  if (!Number.isInteger(ano) || ano < 1900 || ano > 9999) return null
  return { entidadeId, ano }
}

/**
 * Rotas e helpers para o "Contexto de Trabalho" do usuário: escolha de
 * Entidade + Exercício (ano). Persiste em cookie próprio `genesis_exercicio`
 * (formato "<entidadeId>:<ano>") para sobreviver entre páginas.
 */
export async function appContextoRoutes(app: FastifyInstance) {
  const acessos = new AcessosEntidadeService(app.prisma)

  // ── GET: tela de escolha de contexto ────────────────────────────────────────
  app.get('/contexto', async (req, reply) => {
    const lista = await acessos.listarPorUsuario(req.user.sub)
    // Agrupa por município para a UI ficar mais clara.
    const grupos = new Map<string, { municipio: string; estado: string; entidades: typeof lista }>()
    for (const a of lista) {
      const chave = `${a.entidade.municipio.estado.sigla}-${a.entidade.municipio.nome}`
      const grupo = grupos.get(chave) ?? {
        municipio: a.entidade.municipio.nome,
        estado: a.entidade.municipio.estado.sigla,
        entidades: [],
      }
      grupo.entidades.push(a)
      grupos.set(chave, grupo)
    }
    const atual = parseContextoCookie(req.cookies[COOKIE_EXERCICIO])
    return reply.view('app/contexto', {
      grupos: Array.from(grupos.values()),
      anos: ANOS_OFERECIDOS,
      anoCorrente: ANO_CORRENTE,
      atual,
      layout: null,
    })
  })

  // ── POST: salvar escolha ────────────────────────────────────────────────────
  app.post<{ Body: { entidadeId: string; ano: string } }>('/contexto', async (req, reply) => {
    const entidadeId = (req.body.entidadeId ?? '').trim()
    const ano = parseInt((req.body.ano ?? '').trim(), 10)

    if (!entidadeId || !Number.isInteger(ano) || ano < 1900 || ano > 9999) {
      return reply.redirect('/app/contexto')
    }
    // Re-valida acesso server-side (defesa contra entidadeId forjado no form).
    const podeAcessar = await acessos.usuarioPodeAcessar(req.user.sub, entidadeId, 'LEITURA')
    if (!podeAcessar) {
      return reply.redirect('/app/contexto')
    }

    return reply
      .cookie(COOKIE_EXERCICIO, `${entidadeId}:${ano}`, {
        httpOnly: true,
        path: '/',
        maxAge: 60 * 60 * 24 * 30, // 30 dias
        sameSite: 'strict',
        secure: process.env['NODE_ENV'] === 'production',
      })
      .redirect('/app')
  })
}
