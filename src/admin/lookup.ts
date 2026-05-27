import type { FastifyInstance } from 'fastify'

export async function adminLookupRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>('/usuarios', async (req, reply) => {
    const q = req.query.q ?? ''
    const isHtmx = req.headers['hx-target'] === 'lookup-rows-usuarios'

    const usuarios = await app.prisma.usuario.findMany({
      ...(q
        ? {
            where: {
              OR: [
                { nomeCompleto: { contains: q, mode: 'insensitive' } },
                { emailPrincipal: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
      orderBy: { nomeCompleto: 'asc' },
      take: 50,
      select: { id: true, nomeCompleto: true, emailPrincipal: true, ativo: true },
    })

    if (isHtmx) return reply.view('lookup/rows_usuarios', { usuarios })
    return reply.view('lookup/usuarios', { usuarios, q })
  })

  app.get<{ Querystring: { q?: string } }>('/sistemas', async (req, reply) => {
    const q = req.query.q ?? ''
    const isHtmx = req.headers['hx-target'] === 'lookup-rows-sistemas'

    const sistemas = await app.prisma.sistema.findMany({
      ...(q ? { where: { nome: { contains: q, mode: 'insensitive' } } } : {}),
      orderBy: { nome: 'asc' },
      take: 50,
    })

    if (isHtmx) return reply.view('lookup/rows_sistemas', { sistemas })
    return reply.view('lookup/sistemas', { sistemas, q })
  })

  app.get<{ Querystring: { q?: string; sistemaId?: string } }>('/modulos', async (req, reply) => {
    const { q = '', sistemaId } = req.query
    const isHtmx = req.headers['hx-target'] === 'lookup-rows-modulos'

    const modulos = await app.prisma.modulo.findMany({
      where: {
        ...(sistemaId ? { sistemaId } : {}),
        ...(q ? { nome: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ sistema: { nome: 'asc' } }, { nome: 'asc' }],
      take: 50,
      include: { sistema: { select: { nome: true } } },
    })

    if (isHtmx) return reply.view('lookup/rows_modulos', { modulos })
    return reply.view('lookup/modulos', { modulos, q })
  })

  // Contas que admitem movimento de um plano específico — usado como picker
  // no form de lançamentos. planoId é obrigatório (contas só existem em
  // contexto de plano); filtro por código OU descrição.
  app.get<{ Querystring: { q?: string; planoId?: string } }>('/contas', async (req, reply) => {
    const q = (req.query.q ?? '').trim()
    const planoId = (req.query.planoId ?? '').trim()
    const isHtmx = req.headers['hx-target'] === 'lookup-rows-contas'

    if (!planoId) {
      // Sem plano não há resultados possíveis; renderiza a casca vazia.
      if (isHtmx) return reply.view('lookup/rows_contas', { contas: [] })
      return reply.view('lookup/contas', { contas: [], q, planoId: '' })
    }

    const contas = await app.prisma.conta.findMany({
      where: {
        planoId,
        admiteMovimento: true,
        ...(q
          ? {
              OR: [
                { codigo: { contains: q, mode: 'insensitive' } },
                { descricao: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { codigo: 'asc' },
      take: 50,
      select: { id: true, codigo: true, descricao: true },
    })

    if (isHtmx) return reply.view('lookup/rows_contas', { contas })
    return reply.view('lookup/contas', { contas, q, planoId })
  })

  app.get<{ Querystring: { q?: string } }>('/itens', async (req, reply) => {
    const q = req.query.q ?? ''
    const isHtmx = req.headers['hx-target'] === 'lookup-rows-itens'
    const itens = await app.prisma.itemFuncionalidade.findMany({
      where: {
        tipo: 'FUNCIONALIDADE',
        ativo: true,
        ...(q ? { nome: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ menu: { modulo: { sistema: { nome: 'asc' } } } }, { nome: 'asc' }],
      take: 50,
      select: {
        id: true,
        nome: true,
        tipoFuncionalidade: true,
        menu: { select: { nome: true, modulo: { select: { nome: true, sistema: { select: { nome: true } } } } } },
      },
    })

    if (isHtmx) return reply.view('lookup/rows_itens', { itens })
    return reply.view('lookup/itens', { itens, q })
  })
}
