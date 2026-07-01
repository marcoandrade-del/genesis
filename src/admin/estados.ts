import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { EstadosService } from '../services/estados.js'
import { RessincronizadorModelo, descreverResumo } from '../services/ressincronizador-modelo.js'
import { parseComposicao } from '../services/rcl.js'
import { parseClassificacaoFonte } from '../services/fonte-classificacao.js'
import { parsePessoal } from '../services/despesa-pessoal.js'
import { lerXlsxBase64 } from '../services/rcl-xlsx.js'
import { RclImportIaService } from '../services/rcl-import-ia.js'
import { ErroNegocio } from '../errors.js'

export async function adminEstadosRoutes(app: FastifyInstance) {
  const service = new EstadosService(app.prisma)

  app.get('/', async (req, reply) => {
    const [estados, municipiosComEntidade] = await Promise.all([
      app.prisma.estado.findMany({
        orderBy: { nome: 'asc' },
        include: {
          modeloContabil: { select: { id: true, descricao: true } },
          _count: { select: { municipios: true } },
        },
      }),
      // Estados que têm ≥1 entidade ativa com plano contábil copiado (via seus municípios).
      app.prisma.municipio.findMany({
        where: { entidades: { some: { ativo: true, contasContabil: { some: {} } } } },
        select: { estadoId: true },
      }),
    ])
    const estadosComEntidade = [...new Set(municipiosComEntidade.map((m) => m.estadoId))]
    return reply.view(
      'estados/index',
      { title: 'Estados — Gênesis Admin', active: 'estados', userEmail: req.user.email, estados, estadosComEntidade },
      { layout: 'layouts/main' },
    )
  })

  // Estados não suportam create/delete via UI (27 UFs vêm do seed).
  // Só PUT do modeloContabilId.
  app.get<{ Params: { id: string } }>('/:id/form', async (req, reply) => {
    const estado = await app.prisma.estado.findUnique({
      where: { id: req.params.id },
      include: {
        modeloContabil: { select: { id: true, descricao: true } },
        _count: { select: { municipios: true } },
      },
    })
    if (!estado) return reply.status(404).send('Estado não encontrado.')

    // Lista todos os modelos ativos para o select; ordena alfabeticamente.
    const modelos = await app.prisma.modeloContabil.findMany({
      where: { ativo: true },
      orderBy: { descricao: 'asc' },
      select: { id: true, descricao: true },
    })

    return reply.view('estados/form', { estado, modelos, erro: null })
  })

  app.put<{
    Params: { id: string }
    Body: { modeloContabilId?: string; loaCodigoModo?: string; loaCodigoNivel?: string; rclComposicao?: string; fonteClassificacao?: string; pessoalComposicao?: string }
  }>(
    '/:id',
    async (req, reply) => {
      // String vazia = limpar; senão usa o valor recebido.
      const novoId = req.body.modeloContabilId?.trim() ? req.body.modeloContabilId : null
      const modo: 'COMPLETO' | 'CURTO' | 'NIVEL' =
        req.body.loaCodigoModo === 'COMPLETO' || req.body.loaCodigoModo === 'NIVEL' ? req.body.loaCodigoModo : 'CURTO'
      const nivel = Math.min(12, Math.max(1, parseInt(req.body.loaCodigoNivel ?? '', 10) || 4))
      // Composição da RCL editável (JSON do form). Vazio/inválido = limpar (volta ao default).
      let rclComposicao: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull
      const rawRcl = req.body.rclComposicao
      if (rawRcl && rawRcl.trim()) {
        try {
          const cfg = JSON.parse(rawRcl) as Prisma.InputJsonValue
          if (parseComposicao(cfg)) rclComposicao = cfg
        } catch {
          /* JSON inválido → mantém DbNull (limpa) */
        }
      }
      // Classificação de fonte→finalidade editável (mesmo padrão do RCL): vazio/inválido = limpa (volta ao default).
      let fonteClassificacao: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull
      const rawFonte = req.body.fonteClassificacao
      if (rawFonte && rawFonte.trim()) {
        try {
          const cfg = JSON.parse(rawFonte) as Prisma.InputJsonValue
          if (parseClassificacaoFonte(cfg)) fonteClassificacao = cfg
        } catch {
          /* JSON inválido → mantém DbNull (limpa) */
        }
      }
      // Composição da Despesa com Pessoal editável (mesmo padrão): vazio/inválido = limpa (volta ao default).
      let pessoalComposicao: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull
      const rawPessoal = req.body.pessoalComposicao
      if (rawPessoal && rawPessoal.trim()) {
        try {
          const cfg = JSON.parse(rawPessoal) as Prisma.InputJsonValue
          if (parsePessoal(cfg)) pessoalComposicao = cfg
        } catch {
          /* JSON inválido → mantém DbNull (limpa) */
        }
      }
      try {
        await app.prisma.estado.update({
          where: { id: req.params.id },
          data: { loaCodigoModo: modo, loaCodigoNivel: nivel, rclComposicao, fonteClassificacao, pessoalComposicao },
        })
        const r = await service.definirModelo(req.params.id, novoId)
        // Sinaliza ao admin quantos municípios foram tocados pela propagação.
        return reply
          .header('HX-Redirect', '/admin/estados')
          .header(
            'HX-Trigger',
            JSON.stringify({ mostrarInfo: { titulo: 'Modelo atualizado', texto: `${r.municipiosAtualizados} município(s) recebido(s) o novo modelo.` } }),
          )
          .status(204)
          .send()
      } catch (e: unknown) {
        const estado = await app.prisma.estado.findUnique({
          where: { id: req.params.id },
          include: { modeloContabil: true, _count: { select: { municipios: true } } },
        })
        const modelos = await app.prisma.modeloContabil.findMany({
          where: { ativo: true },
          orderBy: { descricao: 'asc' },
          select: { id: true, descricao: true },
        })
        const msg = e instanceof Error ? e.message : 'Erro ao atualizar modelo contábil do estado.'
        return reply.view('estados/form', { estado, modelos, erro: msg })
      }
    },
  )

  // Importa por IA a composição da RCL a partir da planilha (xlsx) do TCE.
  // A IA só PROPÕE: re-renderiza ESTE form com a composição proposta no editor
  // (revisão), preservando os demais campos. O admin confere e clica em Aplicar
  // (o PUT existente salva). Sem chave do provedor → mensagem clara, sem quebrar.
  app.post<{ Params: { id: string }; Body: { planilhaBase64?: string } }>(
    '/:id/rcl-import',
    { bodyLimit: 12 * 1024 * 1024 },
    async (req, reply) => {
      const estado = await app.prisma.estado.findUnique({
        where: { id: req.params.id },
        include: { modeloContabil: { select: { id: true, descricao: true } }, _count: { select: { municipios: true } } },
      })
      if (!estado) return reply.status(404).send('Estado não encontrado.')
      const modelos = await app.prisma.modeloContabil.findMany({
        where: { ativo: true },
        orderBy: { descricao: 'asc' },
        select: { id: true, descricao: true },
      })
      try {
        const texto = await lerXlsxBase64(req.body.planilhaBase64 ?? '')
        const proposta = await new RclImportIaService(app.prisma).proporComposicao(req.user.sub, texto)
        return reply.view('estados/form', { estado, modelos, erro: null, propostaRcl: proposta, avisoIa: `Proposta da IA: "${proposta.nome}".` })
      } catch (e: unknown) {
        const msg = e instanceof ErroNegocio || e instanceof Error ? e.message : 'Falha na importação por IA.'
        return reply.view('estados/form', { estado, modelos, erro: msg })
      }
    },
  )

  // Ressincroniza TODAS as entidades dos municípios deste estado com o modelo
  // atual (recopia o plano-MODELO; desdobramentos/execução são preservados).
  app.post<{ Params: { id: string } }>('/:id/ressincronizar', async (req, reply) => {
    try {
      const resumo = await new RessincronizadorModelo(app.prisma).ressincronizarEstado(req.params.id)
      return reply
        .header('HX-Trigger', JSON.stringify({ mostrarInfo: { titulo: 'Ressincronização concluída', texto: descreverResumo(resumo) } }))
        .status(204)
        .send()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao ressincronizar entidades.'
      return reply.status(400).send(msg)
    }
  })
}
