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
