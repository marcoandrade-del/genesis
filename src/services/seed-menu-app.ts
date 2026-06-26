import { Prisma, type PrismaClient } from '@prisma/client'
import { SISTEMA_APP_NOME } from './menu-app.js'

type ItemSeed = {
  rota: string
  nome: string
  icone: string
  tipo: 'FUNCIONALIDADE' | 'SUBMENU'
  descricao?: string
  filhos?: ItemSeed[]
}

/** Espelha as telas navegáveis do `/app`. `/login`/`/logout`/`/contexto` são infra e ficam fora. */
const AREAS: readonly ItemSeed[] = [
  {
    rota: '/app/orcamento', nome: 'Orçamento', icone: 'bi-cash-coin', tipo: 'SUBMENU',
    descricao: 'Dotações e previsões',
    filhos: [
      { rota: '/app/orcamento/saldo', nome: 'Saldos', icone: 'bi-wallet2', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/orcamento/creditos', nome: 'Créditos adicionais', icone: 'bi-plus-square', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/orcamento/lancamento-tributario', nome: 'Lançamento tributário', icone: 'bi-file-earmark-ruled', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/orcamento/arrecadacao', nome: 'Arrecadação', icone: 'bi-cash-stack', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/orcamento/conciliacao', nome: 'Conciliação bancária', icone: 'bi-arrow-left-right', tipo: 'FUNCIONALIDADE' },
    ],
  },
  {
    rota: '/app/orcamento/relatorios', nome: 'Anexos da LOA', icone: 'bi-file-earmark-text', tipo: 'SUBMENU',
    descricao: 'Demonstrativos legais do orçamento (Lei 4.320)',
    filhos: [
      { rota: '/app/orcamento/relatorios/receita-prevista', nome: 'Receita orçada', icone: 'bi-cash-coin', tipo: 'FUNCIONALIDADE', descricao: 'Anexo 2 — Resumo Geral da Receita' },
      { rota: '/app/orcamento/relatorios/despesa-fixada', nome: 'Despesa fixada', icone: 'bi-graph-down', tipo: 'FUNCIONALIDADE', descricao: 'Anexo 2/9 — natureza, unidade e função' },
      { rota: '/app/orcamento/relatorios/programa-trabalho', nome: 'Programa de trabalho', icone: 'bi-diagram-3', tipo: 'FUNCIONALIDADE', descricao: 'Anexo 6 — UO → função → ação' },
      { rota: '/app/orcamento/relatorios/programa-governo', nome: 'Programa de trabalho de governo', icone: 'bi-diagram-2', tipo: 'FUNCIONALIDADE', descricao: 'Anexo 7 — consolidado por função' },
      { rota: '/app/orcamento/relatorios/despesa-funcoes-programas', nome: 'Despesa por funções e programas', icone: 'bi-bar-chart-steps', tipo: 'FUNCIONALIDADE', descricao: 'Função → programa → subfunção' },
      { rota: '/app/orcamento/relatorios/sumario', nome: 'Sumário geral', icone: 'bi-list-columns', tipo: 'FUNCIONALIDADE', descricao: 'Receita por fontes × despesa por funções' },
    ],
  },
  { rota: '/app/contas-bancarias', nome: 'Contas bancárias', icone: 'bi-bank', tipo: 'FUNCIONALIDADE', descricao: 'Cadastro Febraban por fonte de recurso' },
  { rota: '/app/lancamentos', nome: 'Lançamentos', icone: 'bi-receipt', tipo: 'FUNCIONALIDADE', descricao: 'Execução contábil do exercício' },
  { rota: '/app/contas', nome: 'Plano de Contas', icone: 'bi-diagram-3', tipo: 'FUNCIONALIDADE', descricao: 'Contas contábeis do exercício' },
  { rota: '/app/contas-receita', nome: 'Plano de Receita', icone: 'bi-graph-up-arrow', tipo: 'FUNCIONALIDADE', descricao: 'Contas de receita do exercício' },
  { rota: '/app/contas-despesa', nome: 'Plano de Despesa', icone: 'bi-graph-down-arrow', tipo: 'FUNCIONALIDADE', descricao: 'Contas de despesa do exercício' },
  { rota: '/app/relatorios', nome: 'Relatórios', icone: 'bi-file-earmark-bar-graph', tipo: 'FUNCIONALIDADE', descricao: 'Cabeçalhos e rodapés' },
  { rota: '/app/configuracao', nome: 'Configuração', icone: 'bi-gear', tipo: 'FUNCIONALIDADE', descricao: 'Configuração do dashboard (granularidade dos planos)' },
  {
    rota: '/app/compras', nome: 'Compras', icone: 'bi-cart', tipo: 'SUBMENU',
    descricao: 'Planejamento (Lei 14.133)',
    filhos: [
      { rota: '/app/compras/catalogo', nome: 'Catálogo', icone: 'bi-box-seam', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/pca', nome: 'PCA', icone: 'bi-calendar3', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/demandas', nome: 'Demandas', icone: 'bi-clipboard', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/reservas', nome: 'Reservas', icone: 'bi-bookmark', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/fornecedores', nome: 'Fornecedores', icone: 'bi-truck', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/processos', nome: 'Processos', icone: 'bi-folder', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/contratos', nome: 'Contratos', icone: 'bi-file-earmark-text', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/atas', nome: 'Atas', icone: 'bi-journal-text', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/empenhos', nome: 'Empenhos', icone: 'bi-cash-stack', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/liquidacoes', nome: 'Liquidações', icone: 'bi-check2-square', tipo: 'FUNCIONALIDADE' },
      { rota: '/app/compras/ordens-pagamento', nome: 'Ordens de pagamento', icone: 'bi-credit-card', tipo: 'FUNCIONALIDADE' },
    ],
  },
]

/**
 * Idempotente: semeia o Sistema/Módulo/Menu/itens da navegação do `/app` e
 * concede `VISUALIZAR` a TODOS os usuários existentes. Reexecutar é seguro
 * (cria só o que falta). Não altera schema — sem migração.
 */
export async function semearMenusApp(
  prisma: PrismaClient,
): Promise<{ sistemaId: string; itens: number; grants: number }> {
  const sistema = await prisma.sistema.upsert({
    where: { nome: SISTEMA_APP_NOME },
    create: { nome: SISTEMA_APP_NOME, descricao: 'Navegação da área do operador (/app).' },
    update: {},
  })
  const modulo = await prisma.modulo.upsert({
    where: { nome_sistemaId: { nome: 'Operador', sistemaId: sistema.id } },
    create: { nome: 'Operador', sistemaId: sistema.id, ordem: 0 },
    update: {},
  })
  const menu = await prisma.menu.upsert({
    where: { nome_moduloId: { nome: 'Navegação', moduloId: modulo.id } },
    create: { nome: 'Navegação', moduloId: modulo.id, icone: 'bi-compass', ordem: 0 },
    update: {},
  })

  let itens = 0
  const idsItens: string[] = []

  // ItemFuncionalidade não tem unique em (menuId, rota) → idempotência por find+create.
  const garantirItem = async (seed: ItemSeed, ordem: number, parentId: string | null): Promise<string> => {
    const existente = await prisma.itemFuncionalidade.findFirst({
      where: { menuId: menu.id, rota: seed.rota },
      select: { id: true },
    })
    if (existente) {
      idsItens.push(existente.id)
      return existente.id
    }
    const criado = await prisma.itemFuncionalidade.create({
      data: {
        menuId: menu.id,
        nome: seed.nome,
        descricao: seed.descricao ?? null,
        tipo: seed.tipo,
        tipoFuncionalidade: seed.tipo === 'FUNCIONALIDADE' ? 'TELA' : null,
        rota: seed.rota,
        icone: seed.icone,
        ordem,
        parentId,
      },
      select: { id: true },
    })
    itens++
    idsItens.push(criado.id)
    return criado.id
  }

  for (let i = 0; i < AREAS.length; i++) {
    const area = AREAS[i]!
    const areaId = await garantirItem(area, i, null)
    const filhos = area.filhos ?? []
    for (let j = 0; j < filhos.length; j++) {
      await garantirItem(filhos[j]!, j, areaId)
    }
  }

  // Grant VISUALIZAR para cada usuário × item (create+catch P2002 = idempotente, conta só os novos).
  const usuarios = await prisma.usuario.findMany({ select: { id: true } })
  let grants = 0
  for (const u of usuarios) {
    for (const itemId of idsItens) {
      try {
        await prisma.permissaoAcesso.create({ data: { usuarioId: u.id, itemId, nivel: 'VISUALIZAR' } })
        grants++
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
        throw e
      }
    }
  }

  return { sistemaId: sistema.id, itens, grants }
}
