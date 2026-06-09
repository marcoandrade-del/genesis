/**
 * Escopo do sistema (roadmap) — fonte da verdade do painel `/admin/escopo`.
 *
 * Atende ao item 1 das regras: "visualização HTML do escopo atual do sistema,
 * o que foi feito e o que falta; atualizar sempre que acrescentarmos algo".
 *
 * É um arquivo versionado de propósito: o roadmap acompanha o código real.
 * Ao entregar uma funcionalidade, atualize a `status` (e a `ref` do PR) do item
 * correspondente no mesmo PR — assim o painel nunca descola da realidade.
 */

export type StatusEscopo = 'PRONTO' | 'EM_ANDAMENTO' | 'A_FAZER'

export interface ItemEscopo {
  titulo: string
  descricao: string
  status: StatusEscopo
  /** PR(s) ou referência, ex.: "#55". Opcional. */
  ref?: string
}

export interface AreaEscopo {
  nome: string
  /** Nome do ícone Bootstrap Icons (sem o prefixo `bi-`). */
  icone: string
  descricao: string
  itens: ItemEscopo[]
}

export interface ResumoEscopo {
  total: number
  pronto: number
  emAndamento: number
  aFazer: number
  /** Percentual concluído (0–100, arredondado). 0 quando não há itens. */
  percentConcluido: number
}

/** O que é o Gênesis — resumo de uma linha exibido no topo do painel. */
export const VISAO_GERAL =
  'Framework provedor de infraestrutura web — gestão de menus, módulos, ' +
  'funcionalidades e permissões para sistemas satélites — com uma camada ' +
  'contábil e de compras públicas para o setor público municipal ' +
  '(Lei 4.320/1964 + Lei 14.133/2021).'

/**
 * Roadmap por área. Mantenha em ordem de maturidade/dependência.
 * Status: PRONTO (em produção), EM_ANDAMENTO (sendo construído), A_FAZER (backlog).
 */
export const ESCOPO: readonly AreaEscopo[] = [
  {
    nome: 'Plataforma & Estrutura',
    icone: 'diagram-3',
    descricao: 'Hierarquia de navegação: Sistema → Módulo → Menu → Item de funcionalidade.',
    itens: [
      {
        titulo: 'CRUD de Sistemas, Módulos, Menus e Itens',
        descricao: 'Árvore HTMX com expansão preguiçosa, breadcrumbs e drill-in.',
        status: 'PRONTO',
      },
      {
        titulo: 'Drag-and-drop da árvore de menus',
        descricao: 'Reordenar, mover entre containers, atalho/cópia por modificadores; bloqueio cross-module.',
        status: 'PRONTO',
        ref: '#37',
      },
      {
        titulo: 'Atalhos entre itens + favoritos de item',
        descricao: 'Item referencia outro (atalho) e favoritos por sistema.',
        status: 'PRONTO',
      },
      {
        titulo: 'Painel de escopo (este)',
        descricao: 'Visualização HTML do roadmap: o que é, o que foi feito, o que falta.',
        status: 'PRONTO',
        ref: '#57',
      },
    ],
  },
  {
    nome: 'Usuários & Acesso',
    icone: 'shield-lock',
    descricao: 'Identidade (CPF), ativação, login e permissões — admin e operador.',
    itens: [
      {
        titulo: 'Cadastro de usuário (CPF / ID estrangeiro)',
        descricao: 'Pessoa física única; CPF validado XOR idEstrangeiro; documentos duplicados barrados.',
        status: 'PRONTO',
      },
      {
        titulo: 'Ativação por validação dupla (e-mail + SMS)',
        descricao: 'Códigos por e-mail (nodemailer) e celular (Twilio); login bloqueia até validar.',
        status: 'PRONTO',
      },
      {
        titulo: 'Login admin + permissões por item',
        descricao: 'Cookie próprio; trava de mínimo 1 admin ativo por sistema/módulo.',
        status: 'PRONTO',
      },
      {
        titulo: 'Login do operador (/app) + escolha de contexto',
        descricao: 'Login próprio, escolha de entidade × exercício; só mostra o que o usuário pode acessar.',
        status: 'PRONTO',
        ref: '#34',
      },
      {
        titulo: 'Permissão por entidade',
        descricao: 'AcessoEntidade (usuário × entidade × nível LEITURA/ESCRITA/ADMIN) + UI admin.',
        status: 'PRONTO',
        ref: '#32/#33',
      },
    ],
  },
  {
    nome: 'Contábil — Planos de Contas',
    icone: 'journal-text',
    descricao: 'Modelos por estado/município, três planos (PCASP, receita, despesa) e fontes de recurso.',
    itens: [
      {
        titulo: 'Modelos contábeis + Estados / Municípios / Entidades',
        descricao: 'Modelo por estado/município (entidade herda); 27 UFs fixas.',
        status: 'PRONTO',
      },
      {
        titulo: 'Três planos de contas + fontes de recurso',
        descricao: 'Contábil (PCASP), receita e despesa em tabelas separadas; fontes com saldo por rollup.',
        status: 'PRONTO',
      },
      {
        titulo: 'Importação dos planos TCE-PR 2026',
        descricao: 'PCASP Estendido 8.760 contas, receita 1.808, despesa 3.902 via CSV.',
        status: 'PRONTO',
        ref: '#46/#47',
      },
      {
        titulo: 'Conta nasce analítica + sincronização modelo→entidades',
        descricao: 'Sintética automática ao ganhar filho; criar/editar/excluir no modelo propaga às entidades (atômico).',
        status: 'PRONTO',
        ref: '#55',
      },
      {
        titulo: 'Ressincronização em massa modelo→entidades',
        descricao: 'Botões "Ressincronizar" no Estado (todas as entidades) e no Município (entidades do município) recopiam o plano-MODELO atual; preservam desdobramentos/execução. Cobre a defasagem deixada pela importação em massa do modelo.',
        status: 'PRONTO',
        ref: '#65',
      },
      {
        titulo: 'Atributos PCASP no plano',
        descricao: 'Natureza da Informação, natureza de saldo, superávit financeiro e função das contas (dados TCE-PR); coluna na árvore contábil.',
        status: 'PRONTO',
        ref: '#60',
      },
      {
        titulo: 'Navegação encadeada Estado → Município → Entidade',
        descricao: 'Drill-down por linha (municípios do estado, entidades do município) + acesso aos planos de contas/receita/despesa por linha em cada nível.',
        status: 'PRONTO',
      },
    ],
  },
  {
    nome: 'Orçamento & Execução',
    icone: 'cash-stack',
    descricao: 'Planejamento orçamentário e os três estágios da despesa.',
    itens: [
      {
        titulo: 'Lançamentos contábeis (partida dobrada)',
        descricao: 'Itens dinâmicos, lookup de contas por plano vigente, validação D=C.',
        status: 'PRONTO',
      },
      {
        titulo: 'Planejamento orçamentário',
        descricao: 'Programas, ações, unidades orçamentárias e dotações no contexto do exercício.',
        status: 'PRONTO',
        ref: '#39/#41',
      },
      {
        titulo: 'Execução orçamentária',
        descricao: 'Empenho → liquidação → pagamento (via Compras), consulta de saldo com roll-up (#61) e créditos adicionais com aplicação imediata (#62) prontos. Falta a arrecadação da receita.',
        status: 'EM_ANDAMENTO',
        ref: '#61/#62',
      },
    ],
  },
  {
    nome: 'Compras Públicas (Lei 14.133)',
    icone: 'cart-check',
    descricao: 'Fluxo ponta a ponta: planejamento, seleção do fornecedor e execução financeira.',
    itens: [
      {
        titulo: 'Planejamento (DOD, PCA, reservas de dotação)',
        descricao: 'Documento de demanda vinculado ao plano anual; reserva bloqueia saldo orçamentário.',
        status: 'PRONTO',
        ref: '#35',
      },
      {
        titulo: 'Seleção do fornecedor',
        descricao: 'Processos, fornecedores e atas de registro de preço.',
        status: 'PRONTO',
        ref: '#36',
      },
      {
        titulo: 'Execução (empenho, liquidação, ordem de pagamento)',
        descricao: 'Os três estágios da despesa integrados ao orçamento.',
        status: 'PRONTO',
        ref: '#38',
      },
      {
        titulo: 'Catálogo CATMAT + Compras no /app (consulta)',
        descricao: '162 mil itens importados; catálogo, PCA, DOD e reservas read-only para o operador.',
        status: 'PRONTO',
        ref: '#52',
      },
      {
        titulo: 'Compras no /app — Seleção e Execução',
        descricao: 'Consulta read-only das fases de seleção (fornecedores, processos, contratos, atas) e execução (empenhos, liquidações, OPs) na área do operador, escopada ao contexto.',
        status: 'PRONTO',
        ref: '#59',
      },
    ],
  },
  {
    nome: 'Relatórios',
    icone: 'file-earmark-bar-graph',
    descricao: 'Relatórios fixos/personalizados e o gerador do operador.',
    itens: [
      {
        titulo: 'Relatórios fixos e personalizados + favoritos em pastas',
        descricao: 'Organização aninhada mimetizando favoritos do navegador.',
        status: 'PRONTO',
      },
      {
        titulo: 'Gerador de relatórios (/app)',
        descricao: 'Cabeçalho/rodapé WYSIWYG, query SQL em sandbox isolado por entidade, prévia e pastas.',
        status: 'PRONTO',
        ref: '#42/#43/#44',
      },
      {
        titulo: 'Exportação multi-formato + totais automáticos',
        descricao: 'HTML/TXT/PDF/CSV/XLS/DOC/XML/JSON; total geral e por página quando há valor.',
        status: 'PRONTO',
        ref: '#53/#54',
      },
    ],
  },
]

/** Conta os itens por status e calcula o percentual concluído. */
export function resumirEscopo(areas: readonly AreaEscopo[]): ResumoEscopo {
  let pronto = 0
  let emAndamento = 0
  let aFazer = 0

  for (const area of areas) {
    for (const item of area.itens) {
      if (item.status === 'PRONTO') pronto++
      else if (item.status === 'EM_ANDAMENTO') emAndamento++
      else aFazer++
    }
  }

  const total = pronto + emAndamento + aFazer
  const percentConcluido = total === 0 ? 0 : Math.round((pronto / total) * 100)

  return { total, pronto, emAndamento, aFazer, percentConcluido }
}
