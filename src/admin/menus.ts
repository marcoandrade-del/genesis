import type { FastifyInstance } from 'fastify'
import { SistemasService } from '../services/sistemas.js'
import { MenusService } from '../services/menus.js'
import { ItensService } from '../services/itens.js'
import { ModulosService } from '../services/modulos.js'
import { LixeiraService } from '../services/lixeira.js'

async function carregarArvore(app: FastifyInstance) {
  return app.prisma.sistema.findMany({
    orderBy: { nome: 'asc' },
    include: {
      modulos: {
        orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
        include: {
          menus: {
            orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
            include: {
              itens: {
                where: { parentId: null },
                orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
                include: {
                  subItens: {
                    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
                    include: {
                      subItens: { orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
}

async function buscarSistemaCompleto(app: FastifyInstance, id: string) {
  return app.prisma.sistema.findUnique({
    where: { id },
    include: {
      admins: { include: { usuario: { select: { id: true, nomeCompleto: true } } } },
      _count: { select: { modulos: true } },
    },
  })
}

async function buscarItemCompleto(app: FastifyInstance, id: string) {
  return app.prisma.itemFuncionalidade.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, nome: true, parentId: true } },
      menu: { select: { nome: true, id: true } },
      _count: { select: { subItens: true } },
    },
  })
}

function calcProfundidade(item: { parentId: string | null; parent?: { parentId: string | null; parent?: { parentId: string | null } | null } | null } | null) {
  let depth = 0
  let cur: { parentId: string | null; parent?: { parentId: string | null } | null } | null = item
  while (cur?.parentId) { depth++; cur = cur.parent ?? null }
  return depth
}

export async function adminMenusRoutes(app: FastifyInstance) {
  const sistemasSvc = new SistemasService(app.prisma)
  const modulosSvc = new ModulosService(app.prisma)
  const menusSvc = new MenusService(app.prisma)
  const itensSvc = new ItensService(app.prisma)
  const lixeiraSvc = new LixeiraService(app.prisma)

  // ── Página principal ──────────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const arvore = await carregarArvore(app)
    return reply.view(
      'menus/index',
      { title: 'Estrutura de Navegação — Gênesis Admin', active: 'menus', userEmail: req.user.email, arvore },
      { layout: 'layouts/main' },
    )
  })

  // ── Parcial da árvore (HTMX refresh) ─────────────────────────────────────────
  app.get('/arvore', async (req, reply) => {
    const arvore = await carregarArvore(app)
    return reply.view('menus/arvore', { arvore })
  })

  // ── Painéis de detalhe ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/painel/sistema/:id', async (req, reply) => {
    const sistema = await buscarSistemaCompleto(app, req.params.id)
    if (!sistema) return reply.status(404).send('Sistema não encontrado.')
    return reply.view('menus/painel-sistema', { sistema })
  })

  app.get<{ Params: { id: string } }>('/painel/modulo/:id', async (req, reply) => {
    const modulo = await app.prisma.modulo.findUnique({
      where: { id: req.params.id },
      include: { sistema: { select: { nome: true } }, _count: { select: { menus: true } } },
    })
    if (!modulo) return reply.status(404).send('Módulo não encontrado.')
    return reply.view('menus/painel-modulo', { modulo, sistema: null, adminPadrao: null, editando: true, erro: null })
  })

  app.get<{ Params: { id: string } }>('/painel/menu/:id', async (req, reply) => {
    const menu = await app.prisma.menu.findUnique({
      where: { id: req.params.id },
      include: { modulo: { select: { nome: true } } },
    })
    if (!menu) return reply.status(404).send('Menu não encontrado.')
    return reply.view('menus/painel-menu', { menu, modulo: null, editando: true, erro: null })
  })

  app.get<{ Params: { id: string } }>('/painel/item/:id', async (req, reply) => {
    const item = await buscarItemCompleto(app, req.params.id)
    if (!item) return reply.status(404).send('Item não encontrado.')
    return reply.view('menus/painel-item', {
      item, menu: null, parentItem: null,
      profundidade: calcProfundidade(item), editando: true, erro: null,
    })
  })

  // ── Formulários para novos nós ────────────────────────────────────────────────
  app.get('/novo/sistema', async (req, reply) => {
    const adminPadrao = await app.prisma.usuario.findUnique({
      where: { id: req.user.sub },
      select: { id: true, nomeCompleto: true },
    })
    return reply.view('menus/painel-sistema-form', { sistema: null, adminPadrao, adminAtual: null, erro: null })
  })

  app.get<{ Params: { id: string } }>('/painel/sistema/:id/editar', async (req, reply) => {
    const sistema = await sistemasSvc.buscarComAdmins(req.params.id)
    if (!sistema) return reply.status(404).send('Sistema não encontrado.')
    const adminAtual = sistema.admins[0]?.usuario ?? null
    return reply.view('menus/painel-sistema-form', { sistema, adminPadrao: null, adminAtual, erro: null })
  })

  app.get<{ Querystring: { sistemaId: string } }>('/novo/modulo', async (req, reply) => {
    const sistema = await app.prisma.sistema.findUnique({
      where: { id: req.query.sistemaId },
      select: { id: true, nome: true },
    })
    const adminPadrao = await app.prisma.usuario.findUnique({
      where: { id: req.user.sub },
      select: { id: true, nomeCompleto: true },
    })
    return reply.view('menus/painel-modulo', { modulo: null, sistema, adminPadrao, editando: false, erro: null })
  })

  app.get<{ Querystring: { moduloId: string } }>('/novo/menu', async (req, reply) => {
    const modulo = await app.prisma.modulo.findUnique({
      where: { id: req.query.moduloId },
      select: { id: true, nome: true },
    })
    return reply.view('menus/painel-menu', { menu: null, modulo, editando: false, erro: null })
  })

  app.get<{ Querystring: { menuId: string; parentId?: string } }>('/novo/item', async (req, reply) => {
    const { menuId, parentId } = req.query
    const menu = await app.prisma.menu.findUnique({ where: { id: menuId }, select: { id: true, nome: true } })
    let parentItem = null
    let profundidade = 0
    if (parentId) {
      parentItem = await app.prisma.itemFuncionalidade.findUnique({
        where: { id: parentId },
        select: { id: true, nome: true, parentId: true },
      })
      profundidade = parentItem?.parentId !== null ? 2 : 1
    }
    return reply.view('menus/painel-item', { item: null, menu, parentItem, profundidade, editando: false, erro: null })
  })

  // ── Criar sistema ─────────────────────────────────────────────────────────────
  app.post<{ Body: { nome: string; descricao?: string; adminUsuarioId: string } }>(
    '/novo/sistema',
    async (req, reply) => {
      const { nome, descricao, adminUsuarioId } = req.body
      const adminPadrao = await app.prisma.usuario.findUnique({
        where: { id: req.user.sub },
        select: { id: true, nomeCompleto: true },
      })
      if (!nome?.trim()) {
        return reply.view('menus/painel-sistema-form', { sistema: null, adminPadrao, adminAtual: null, erro: 'O nome é obrigatório.' })
      }
      if (!adminUsuarioId) {
        return reply.view('menus/painel-sistema-form', {
          sistema: null, adminPadrao, adminAtual: null, erro: 'Selecione um administrador.',
        })
      }
      try {
        const criado = await sistemasSvc.criar({ nome, adminUsuarioId, ...(descricao ? { descricao } : {}) })
        const sistema = await buscarSistemaCompleto(app, criado.id)
        return reply
          .header('HX-Trigger', JSON.stringify({ 'refresh-tree': true }))
          .view('menus/painel-sistema', { sistema })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao criar sistema.'
        return reply.view('menus/painel-sistema-form', { sistema: null, adminPadrao, adminAtual: null, erro: msg })
      }
    },
  )

  // ── Atualizar sistema ─────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { nome: string; descricao?: string; ativo: string; adminUsuarioId?: string } }>(
    '/sistema/:id',
    async (req, reply) => {
      const { nome, descricao, ativo, adminUsuarioId } = req.body
      if (!nome?.trim()) {
        const sistema = await sistemasSvc.buscarComAdmins(req.params.id)
        const adminAtual = sistema?.admins[0]?.usuario ?? null
        return reply.view('menus/painel-sistema-form', { sistema, adminPadrao: null, adminAtual, erro: 'O nome é obrigatório.' })
      }
      try {
        await sistemasSvc.atualizar(req.params.id, {
          ...(nome ? { nome } : {}),
          ...(descricao !== undefined ? { descricao } : {}),
          ativo: ativo === 'true',
        })
        if (adminUsuarioId) await sistemasSvc.trocarAdmin(req.params.id, adminUsuarioId)
        const sistema = await buscarSistemaCompleto(app, req.params.id)
        return reply
          .header('HX-Trigger', JSON.stringify({ 'refresh-tree': true }))
          .view('menus/painel-sistema', { sistema })
      } catch (e: unknown) {
        const sistema = await sistemasSvc.buscarComAdmins(req.params.id)
        const adminAtual = sistema?.admins[0]?.usuario ?? null
        const msg = e instanceof Error ? e.message : 'Erro ao atualizar sistema.'
        return reply.view('menus/painel-sistema-form', { sistema, adminPadrao: null, adminAtual, erro: msg })
      }
    },
  )

  // ── Criar módulo ──────────────────────────────────────────────────────────────
  app.post<{ Body: { sistemaId: string; nome: string; descricao?: string; adminUsuarioId: string } }>(
    '/novo/modulo',
    async (req, reply) => {
      const { sistemaId, nome, descricao, adminUsuarioId } = req.body
      const sistema = await app.prisma.sistema.findUnique({ where: { id: sistemaId }, select: { id: true, nome: true } })
      const adminPadrao = await app.prisma.usuario.findUnique({
        where: { id: req.user.sub },
        select: { id: true, nomeCompleto: true },
      })
      if (!nome?.trim()) {
        return reply.view('menus/painel-modulo', { modulo: null, sistema, adminPadrao, editando: false, erro: 'O nome é obrigatório.' })
      }
      if (!adminUsuarioId) {
        return reply.view('menus/painel-modulo', {
          modulo: null, sistema, adminPadrao, editando: false, erro: 'Selecione um administrador.',
        })
      }
      try {
        const criado = await modulosSvc.criar(sistemaId, { nome, adminUsuarioId, ...(descricao ? { descricao } : {}) })
        const modulo = await app.prisma.modulo.findUnique({
          where: { id: criado.id },
          include: { sistema: { select: { nome: true } }, _count: { select: { menus: true } } },
        })
        return reply
          .header('HX-Trigger', JSON.stringify({ 'refresh-tree': true }))
          .view('menus/painel-modulo', { modulo, sistema: null, adminPadrao: null, editando: true, erro: null })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao criar módulo.'
        return reply.view('menus/painel-modulo', { modulo: null, sistema, adminPadrao, editando: false, erro: msg })
      }
    },
  )

  // ── Criar menu ────────────────────────────────────────────────────────────────
  app.post<{ Body: { moduloId: string; nome: string; icone?: string; ordem?: string } }>(
    '/novo/menu',
    async (req, reply) => {
      const { moduloId, nome, icone, ordem } = req.body
      if (!moduloId?.trim()) {
        return reply.view('menus/painel-menu', { menu: null, modulo: null, editando: false, erro: 'Módulo não encontrado.' })
      }
      if (!nome?.trim()) {
        const modulo = await app.prisma.modulo.findUnique({ where: { id: moduloId }, select: { id: true, nome: true } })
        return reply.view('menus/painel-menu', { menu: null, modulo, editando: false, erro: 'O nome é obrigatório.' })
      }
      const modulo = await app.prisma.modulo.findUnique({ where: { id: moduloId }, select: { id: true, nome: true } })
      try {
        const criado = await menusSvc.criar(moduloId, {
          nome,
          ...(icone ? { icone } : {}),
          ...(ordem ? { ordem: parseInt(ordem) } : {}),
        })
        const menu = await app.prisma.menu.findUnique({
          where: { id: criado.id },
          include: { modulo: { select: { nome: true } } },
        })
        return reply
          .header('HX-Trigger', JSON.stringify({ 'refresh-tree': true }))
          .view('menus/painel-menu', { menu, modulo: null, editando: true, erro: null })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao criar menu.'
        return reply.view('menus/painel-menu', { menu: null, modulo, editando: false, erro: msg })
      }
    },
  )

  // ── Criar item ────────────────────────────────────────────────────────────────
  app.post<{
    Body: {
      menuId: string; parentId?: string; nome: string; tipo: string
      tipoFuncionalidade?: string; rota?: string; icone?: string; ordem?: string; descricao?: string
    }
  }>('/novo/item', async (req, reply) => {
    const { menuId, parentId, nome, tipo, tipoFuncionalidade, rota, icone, ordem, descricao } = req.body
    const menu = await app.prisma.menu.findUnique({ where: { id: menuId }, select: { id: true, nome: true } })
    let parentItem = null
    let profundidade = 0
    if (parentId) {
      parentItem = await app.prisma.itemFuncionalidade.findUnique({
        where: { id: parentId },
        select: { id: true, nome: true, parentId: true },
      })
      profundidade = parentItem?.parentId !== null ? 2 : 1
    }
    if (profundidade >= 1 && tipo === 'SUBMENU') {
      const msg = 'Submenu não pode ter outro submenu como filho. Escolha o tipo FUNCIONALIDADE.'
      return reply.view('menus/painel-item', { item: null, menu, parentItem, profundidade, editando: false, erro: msg })
    }
    try {
      const criado = await itensSvc.criar(menuId, {
        nome,
        tipo: tipo as any,
        ...(tipoFuncionalidade ? { tipoFuncionalidade: tipoFuncionalidade as any } : {}),
        ...(rota ? { rota } : {}),
        ...(icone ? { icone } : {}),
        ...(ordem ? { ordem: parseInt(ordem) } : {}),
        ...(descricao ? { descricao } : {}),
        ...(parentId ? { parentId } : {}),
      })
      const item = await buscarItemCompleto(app, criado.id)
      return reply
        .header('HX-Trigger', JSON.stringify({ 'refresh-tree': true }))
        .view('menus/painel-item', {
          item, menu: null, parentItem: null,
          profundidade: calcProfundidade(item), editando: true, erro: null,
        })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar item.'
      return reply.view('menus/painel-item', { item: null, menu, parentItem, profundidade, editando: false, erro: msg })
    }
  })

  // ── Atualizar módulo ──────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { nome: string; descricao?: string; ativo: string } }>(
    '/modulo/:id',
    async (req, reply) => {
      const { nome, descricao, ativo } = req.body
      if (!nome?.trim()) {
        const modulo = await app.prisma.modulo.findUnique({
          where: { id: req.params.id },
          include: { sistema: { select: { nome: true } }, _count: { select: { menus: true } } },
        })
        return reply.view('menus/painel-modulo', { modulo, sistema: null, adminPadrao: null, editando: true, erro: 'O nome é obrigatório.' })
      }
      try {
        await modulosSvc.atualizar(req.params.id, {
          ...(nome ? { nome } : {}),
          ...(descricao !== undefined ? { descricao } : {}),
          ativo: ativo === 'true',
        })
        const modulo = await app.prisma.modulo.findUnique({
          where: { id: req.params.id },
          include: { sistema: { select: { nome: true } }, _count: { select: { menus: true } } },
        })
        return reply
          .header('HX-Trigger', JSON.stringify({ 'refresh-tree': true }))
          .view('menus/painel-modulo', { modulo, sistema: null, adminPadrao: null, editando: true, erro: null })
      } catch (e: unknown) {
        const modulo = await app.prisma.modulo.findUnique({
          where: { id: req.params.id },
          include: { sistema: { select: { nome: true } }, _count: { select: { menus: true } } },
        })
        const msg = e instanceof Error ? e.message : 'Erro ao atualizar módulo.'
        return reply.view('menus/painel-modulo', { modulo, sistema: null, adminPadrao: null, editando: true, erro: msg })
      }
    },
  )

  // ── Atualizar menu ────────────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { nome: string; icone?: string; ordem?: string; ativo: string } }>(
    '/menu/:id',
    async (req, reply) => {
      const { nome, icone, ordem, ativo } = req.body
      if (!nome?.trim()) {
        const menu = await app.prisma.menu.findUnique({ where: { id: req.params.id }, include: { modulo: { select: { nome: true } } } })
        return reply.view('menus/painel-menu', { menu, modulo: null, editando: true, erro: 'O nome é obrigatório.' })
      }
      try {
        await menusSvc.atualizar(req.params.id, {
          ...(nome ? { nome } : {}),
          ...(icone !== undefined ? { icone } : {}),
          ...(ordem ? { ordem: parseInt(ordem) } : {}),
          ativo: ativo === 'true',
        })
        const menu = await app.prisma.menu.findUnique({
          where: { id: req.params.id },
          include: { modulo: { select: { nome: true } } },
        })
        return reply
          .header('HX-Trigger', JSON.stringify({ 'refresh-tree': true }))
          .view('menus/painel-menu', { menu, modulo: null, editando: true, erro: null })
      } catch (e: unknown) {
        const menu = await app.prisma.menu.findUnique({
          where: { id: req.params.id },
          include: { modulo: { select: { nome: true } } },
        })
        const msg = e instanceof Error ? e.message : 'Erro ao atualizar menu.'
        return reply.view('menus/painel-menu', { menu, modulo: null, editando: true, erro: msg })
      }
    },
  )

  // ── Atualizar item ────────────────────────────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: { nome: string; descricao?: string; tipoFuncionalidade?: string; rota?: string; icone?: string; ordem?: string; ativo: string }
  }>('/item/:id', async (req, reply) => {
    const { nome, descricao, tipoFuncionalidade, rota, icone, ordem, ativo } = req.body
    if (!nome?.trim()) {
      const item = await buscarItemCompleto(app, req.params.id)
      return reply.view('menus/painel-item', { item, menu: null, parentItem: null, profundidade: calcProfundidade(item), editando: true, erro: 'O nome é obrigatório.' })
    }
    try {
      await itensSvc.atualizar(req.params.id, {
        ...(nome ? { nome } : {}),
        ...(descricao !== undefined ? { descricao } : {}),
        ...(tipoFuncionalidade ? { tipoFuncionalidade: tipoFuncionalidade as any } : {}),
        ...(rota !== undefined ? { rota } : {}),
        ...(icone !== undefined ? { icone } : {}),
        ...(ordem ? { ordem: parseInt(ordem) } : {}),
        ativo: ativo === 'true',
      })
      const item = await buscarItemCompleto(app, req.params.id)
      return reply
        .header('HX-Trigger', JSON.stringify({ 'refresh-tree': true }))
        .view('menus/painel-item', {
          item, menu: null, parentItem: null,
          profundidade: calcProfundidade(item), editando: true, erro: null,
        })
    } catch (e: unknown) {
      const item = await buscarItemCompleto(app, req.params.id)
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar item.'
      return reply.view('menus/painel-item', {
        item, menu: null, parentItem: null,
        profundidade: calcProfundidade(item), editando: true, erro: msg,
      })
    }
  })

  // ── Excluir sistema ───────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/sistema/:id', async (req, reply) => {
    try {
      await sistemasSvc.excluir(req.params.id, req.user.sub, lixeiraSvc)
      return reply.header('HX-Trigger', JSON.stringify({ 'refresh-tree': true })).view('menus/painel-vazio', {})
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir sistema.'
      return reply.status(400).send(msg)
    }
  })

  // ── Excluir módulo ────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/modulo/:id', async (req, reply) => {
    try {
      await modulosSvc.excluir(req.params.id, req.user.sub, lixeiraSvc)
      return reply.header('HX-Trigger', JSON.stringify({ 'refresh-tree': true })).view('menus/painel-vazio', {})
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir módulo.'
      return reply.status(400).send(msg)
    }
  })

  // ── Excluir menu ──────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/menu/:id', async (req, reply) => {
    try {
      await menusSvc.excluir(req.params.id, req.user.sub, lixeiraSvc)
      return reply.header('HX-Trigger', JSON.stringify({ 'refresh-tree': true })).view('menus/painel-vazio', {})
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir menu.'
      return reply.status(400).send(msg)
    }
  })

  // ── Excluir item ──────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/item/:id', async (req, reply) => {
    try {
      await itensSvc.excluir(req.params.id, req.user.sub, lixeiraSvc)
      return reply.header('HX-Trigger', JSON.stringify({ 'refresh-tree': true })).view('menus/painel-vazio', {})
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao excluir item.'
      return reply.status(400).send(msg)
    }
  })

  // ── Contar filhos (para UI de confirmação) ────────────────────────────────────
  app.get<{ Params: { tipo: string; id: string } }>('/contar-filhos/:tipo/:id', async (req, reply) => {
    try {
      const { tipo, id } = req.params
      let count = 0
      if (tipo === 'sistema') {
        const r = await lixeiraSvc.contarFilhosSistema(id)
        if (r.relatorios > 0) {
          return reply.send({
            count: 0,
            bloqueado: true,
            mensagemBloqueio: `Este sistema possui ${r.relatorios} relatório(s) fixo(s) vinculado(s). Remova-os antes de excluir o sistema.`,
          })
        }
        count = r.modulos + r.menus
      } else if (tipo === 'modulo') {
        count = await lixeiraSvc.contarFilhosModulo(id)
      } else if (tipo === 'menu') {
        count = await lixeiraSvc.contarFilhosMenu(id)
      } else if (tipo === 'item') {
        count = await lixeiraSvc.contarFilhosItem(id)
      }
      return reply.send({ count })
    } catch {
      return reply.send({ count: 0 })
    }
  })

  // ── Reordenar módulos ──────────────────────────────────────────────────────────
  app.post<{ Body: { ids: string } }>('/reordenar/modulos', async (req, reply) => {
    try {
      const ids: string[] = JSON.parse(req.body.ids)
      await app.prisma.$transaction(ids.map((id, i) => app.prisma.modulo.update({ where: { id }, data: { ordem: i } })))
      return reply.send({ ok: true })
    } catch {
      return reply.status(400).send({ ok: false })
    }
  })

  // ── Reordenar menus ────────────────────────────────────────────────────────────
  app.post<{ Body: { ids: string } }>('/reordenar/menus', async (req, reply) => {
    try {
      const ids: string[] = JSON.parse(req.body.ids)
      await menusSvc.reordenar(ids)
      return reply.send({ ok: true })
    } catch {
      return reply.status(400).send({ ok: false })
    }
  })

  // ── Reordenar itens ────────────────────────────────────────────────────────────
  app.post<{ Body: { ids: string } }>('/reordenar/itens', async (req, reply) => {
    try {
      const ids: string[] = JSON.parse(req.body.ids)
      await itensSvc.reordenar(ids)
      return reply.send({ ok: true })
    } catch {
      return reply.status(400).send({ ok: false })
    }
  })

  // ── Copiar item ───────────────────────────────────────────────────────────────
  app.post<{ Body: { itemId: string; novoParentId?: string; novoMenuId: string } }>('/copiar/item', async (req, reply) => {
    try {
      const { itemId, novoParentId, novoMenuId } = req.body
      await itensSvc.copiar(itemId, novoParentId || null, novoMenuId)
      return reply.header('HX-Trigger', JSON.stringify({ 'refresh-tree': true })).send({ ok: true })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao copiar item.'
      return reply.status(400).send({ ok: false, erro: msg })
    }
  })

  // ── Destinos disponíveis para mover um item ──────────────────────────────────
  app.get<{ Params: { id: string } }>('/destinos-item/:id', async (req, reply) => {
    const item = await app.prisma.itemFuncionalidade.findUnique({
      where: { id: req.params.id },
      select: { tipo: true, menuId: true, parentId: true, menu: { select: { moduloId: true } } },
    })
    if (!item) return reply.status(404).send({ erro: 'Item não encontrado.' })

    const moduloId = item.menu.moduloId

    // Destinos limitados ao mesmo módulo
    const modulo = await app.prisma.modulo.findUnique({
      where: { id: moduloId },
      include: {
        sistema: { select: { nome: true } },
        menus: {
          orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
          include: {
            itens: {
              where: { tipo: 'SUBMENU', parentId: null },
              orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
              include: {
                subItens: { where: { tipo: 'SUBMENU' }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] },
              },
            },
          },
        },
      },
    })
    if (!modulo) return reply.status(404).send({ erro: 'Módulo não encontrado.' })

    type Destino = { menuId: string; parentId: string | null; label: string }
    const destinos: Destino[] = []
    const prefixo = `${modulo.sistema.nome} › ${modulo.nome}`

    // Itera apenas os menus do mesmo módulo
    for (const menu of modulo.menus) {
          if (!(item.menuId === menu.id && item.parentId === null)) {
            destinos.push({ menuId: menu.id, parentId: null, label: `${prefixo} › ${menu.nome}` })
          }
          if (item.tipo === 'FUNCIONALIDADE') {
            for (const sub1 of menu.itens) {
              if (!(item.menuId === menu.id && item.parentId === sub1.id)) {
                destinos.push({ menuId: menu.id, parentId: sub1.id, label: `${prefixo} › ${menu.nome} › ${sub1.nome}` })
              }
              for (const sub2 of sub1.subItens) {
                if (!(item.menuId === menu.id && item.parentId === sub2.id)) {
                  destinos.push({ menuId: menu.id, parentId: sub2.id, label: `${prefixo} › ${menu.nome} › ${sub1.nome} › ${sub2.nome}` })
                }
              }
            }
          }
        }

    return reply.send(destinos)
  })

  // ── Mover item (reparentar + reordenar irmãos) ───────────────────────────────
  app.post<{ Body: { itemId: string; novoParentId?: string; menuId?: string; idsOrdem?: string; mover?: string } }>(
    '/mover/item',
    async (req, reply) => {
      try {
        const { itemId, novoParentId, menuId, idsOrdem, mover } = req.body
        if (mover) {
          await itensSvc.mover(itemId, novoParentId || null, menuId || undefined)
        }
        if (idsOrdem) {
          const ids: string[] = JSON.parse(idsOrdem)
          await app.prisma.$transaction(
            ids.map((id, i) => app.prisma.itemFuncionalidade.update({ where: { id }, data: { ordem: i } }))
          )
        }
        return reply.send({ ok: true })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao mover item.'
        return reply.status(400).send({ ok: false, erro: msg })
      }
    }
  )
}
