import { describe, it, expect, vi } from 'vitest'
import ejs from 'ejs'
import { criarPrismaMock, type PrismaMock } from './helpers/prisma-mock.js'
import { semearMenusApp } from '../seed-menu-app.js'

// ── Mock stateful do ItemFuncionalidade ──────────────────────────────────────
// O helper compartilhado não cobre a semântica de idempotência do seed
// (findFirst por rota + upsert de Sistema/Módulo/Menu). Montamos aqui um store em
// memória: findFirst casa por `rota` (preservando id), create atribui id novo,
// update aplica sobre o id existente. Isso deixa asseverar identidade × reorg.
type Item = {
  id: string; rota: string; nome: string; descricao: string | null
  icone: string; tipo: string; parentId: string | null; ordem: number
}
function instrumentar(mock: PrismaMock) {
  const store = new Map<string, Item>()
  let seq = 0
  const im = mock.itemFuncionalidade as unknown as Record<string, ReturnType<typeof vi.fn>>
  im['findFirst'] = vi.fn(async ({ where }: { where: { rota: string } }) => {
    const it = store.get(where.rota)
    return it ? { ...it } : null
  })
  im['create'] = vi.fn(async ({ data }: { data: Omit<Item, 'id'> }) => {
    const id = `item-${++seq}`
    store.set(data.rota, { id, ...data, descricao: data.descricao ?? null })
    return { id }
  })
  im['update'] = vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Item> }) => {
    for (const [rota, it] of store) {
      if (it.id === where.id) { store.set(rota, { ...it, ...data }); break }
    }
    return {}
  })
  ;(mock.sistema as unknown as { upsert: ReturnType<typeof vi.fn> }).upsert = vi.fn().mockResolvedValue({ id: 'sis' })
  ;(mock.modulo as unknown as { upsert: ReturnType<typeof vi.fn> }).upsert = vi.fn().mockResolvedValue({ id: 'mod' })
  ;(mock.menu as unknown as { upsert: ReturnType<typeof vi.fn> }).upsert = vi.fn().mockResolvedValue({ id: 'menu-1' })
  mock.usuario.findMany.mockResolvedValue([]) // sem usuários → pula a concessão de grants
  return { store, create: im['create']!, update: im['update']! }
}

const GRUPOS_ESPERADOS = [
  'Planejamento / LOA', 'Execução', 'LRF', 'Planos & Cadastros', 'Compras', 'Ferramentas',
]
const ROTAS_NOVAS = [
  '/app/orcamento/despesa/execucao',
  '/app/orcamento/despesa/diario',
  '/app/orcamento/arrecadacao/diario',
  '/app/conversor',
]

describe('semearMenusApp — sidebar de 6 domínios', () => {
  it('1º run: cria os 6 grupos SUBMENU + folhas, com rotas únicas e as telas surfacadas', async () => {
    const mock = criarPrismaMock()
    const { store, create, update } = instrumentar(mock)

    await semearMenusApp(mock as never)

    // Tudo criado no 1º run; nada atualizado.
    expect(create).toHaveBeenCalledTimes(store.size)
    expect(update).not.toHaveBeenCalled()

    // Exatamente 6 grupos de topo, todos SUBMENU, na ordem definida.
    const grupos = [...store.values()].filter((i) => i.parentId === null)
    expect(grupos).toHaveLength(6)
    expect(grupos.every((g) => g.tipo === 'SUBMENU')).toBe(true)
    expect(grupos.map((g) => g.nome)).toEqual(GRUPOS_ESPERADOS)

    // Nenhuma rota duplicada (identidade por rota exige unicidade).
    const rotas = [...store.keys()]
    expect(new Set(rotas).size).toBe(rotas.length)

    // As telas que existiam mas nunca apareciam no menu agora estão lá.
    for (const r of ROTAS_NOVAS) expect(store.has(r)).toBe(true)
  })

  it('re-run idêntico é inerte: sem create e sem update (idempotência)', async () => {
    const mock = criarPrismaMock()
    const { store, create, update } = instrumentar(mock)

    await semearMenusApp(mock as never) // popula
    const idsAntes = new Map([...store].map(([rota, it]) => [rota, it.id]))
    create.mockClear(); update.mockClear()

    await semearMenusApp(mock as never) // 2º run

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    for (const [rota, it] of store) expect(it.id).toBe(idsAntes.get(rota)) // ids intactos
  })

  it('reorganização preserva o id e renomeia/re-parenta itens já semeados', async () => {
    const mock = criarPrismaMock()
    const { store, create, update } = instrumentar(mock)

    // Estrutura ANTIGA já no banco: 'Orçamento' (grupo raiz) e 'Plano de Contas' (raiz solta).
    store.set('/app/orcamento', {
      id: 'ID-ORCAMENTO', rota: '/app/orcamento', nome: 'Orçamento',
      descricao: 'Dotações e previsões', icone: 'bi-cash-coin', tipo: 'SUBMENU', parentId: null, ordem: 0,
    })
    store.set('/app/contas', {
      id: 'ID-CONTAS', rota: '/app/contas', nome: 'Plano de Contas',
      descricao: 'Contas contábeis do exercício', icone: 'bi-diagram-3', tipo: 'FUNCIONALIDADE', parentId: null, ordem: 5,
    })

    await semearMenusApp(mock as never)

    // ids preservados → PermissaoAcesso/FavoritoItem/OrdemItemUsuario continuam válidos.
    expect(store.get('/app/orcamento')!.id).toBe('ID-ORCAMENTO')
    expect(store.get('/app/contas')!.id).toBe('ID-CONTAS')
    // Não recriou esses dois (só os demais).
    const criadas = create.mock.calls.map((c) => (c[0] as { data: { rota: string } }).data.rota)
    expect(criadas).not.toContain('/app/orcamento')
    expect(criadas).not.toContain('/app/contas')
    // Renomeou o grupo e re-parentou a folha (via update, id-preserving).
    expect(update).toHaveBeenCalled()
    expect(store.get('/app/orcamento')!.nome).toBe('Planejamento / LOA')
    expect(store.get('/app/contas')!.parentId).not.toBeNull() // agora dentro de 'Planos & Cadastros'
  })
})

describe('_sidebar.ejs — render dos 6 domínios', () => {
  const dados = {
    entidade: { nome: 'Prefeitura do Município de Maringá', municipio: { nome: 'Maringá', estado: { sigla: 'PR' } } },
    ano: 2026,
    nivel: 'ADMIN',
    favoritoIds: ['c1'],
    menuApp: GRUPOS_ESPERADOS.map((nome, i) => ({
      id: `g${i}`, nome, icone: 'bi-grid', rota: i === 0 ? '/app/orcamento' : `#g${i}`, tipo: 'SUBMENU',
      filhos: [{ id: `c${i}`, nome: `Tela ${i}`, icone: 'bi-dot', rota: `/app/tela-${i}`, tipo: 'FUNCIONALIDADE' }],
    })),
  }

  it('renderiza a sidebar com os 6 grupos e um link navegável marcável', async () => {
    const html = await ejs.renderFile('src/views/app/_navbar.ejs', dados)
    // Um cabeçalho de grupo por domínio (conta o botão, não as regras CSS).
    const grupos = (html.match(/class="gx-side-group-hd"/g) || []).length
    expect(grupos).toBe(6)
    for (const nome of GRUPOS_ESPERADOS) expect(html).toContain(nome)
    // A âncora sentinela (#g1) NÃO vira data-gx-route (só expande); a real vira.
    expect(html).toContain('data-gx-route="/app/tela-0"')
    expect(html).not.toContain('data-gx-route="#g1"')
    // Chrome novo presente, chrome velho ausente.
    expect(html).toContain('gx-strip')
    expect(html).not.toContain('class="gx-nav"')
  })
})
