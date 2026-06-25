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
      {
        titulo: 'Navegação dinâmica do /app + menu superior (Command Bar)',
        descricao: 'Menus do operador derivados do menu do core; barra de comando superior redesenhada.',
        status: 'PRONTO',
        ref: '#66/#79',
      },
      {
        titulo: 'Área de Trabalho customizável (operador)',
        descricao: 'Barra de favoritos estilo navegador (#102), painel de cards reordenável por arrasto per-user (#105) e configuração de granularidade dos planos por entidade/relatório (#99/#100).',
        status: 'PRONTO',
        ref: '#102/#105',
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
      {
        titulo: 'Solicitação de acesso a entidades (operador)',
        descricao: 'Usuário sem acesso entra e solicita acesso a uma entidade (nível desejado + justificativa). Aprovação em dois lugares: fila no admin do sistema e painel do admin da entidade no /app (aprova/rejeita + gerencia nível/revogação, escopado à entidade).',
        status: 'PRONTO',
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
      {
        titulo: 'Abertura de exercício (virada de ano)',
        descricao: 'Copia os planos do ano novo do modelo para entidades existentes; complementa a cópia automática do onboarding e a ressincronização.',
        status: 'PRONTO',
      },
      {
        titulo: 'Desdobramento de contas no operador (/app)',
        descricao: 'Desdobrar contábil/receita/despesa na entidade; conta com saldo/movimento usa fluxo de DISTRIBUIÇÃO (rateio retroativo, recompõe saldos, zera a mãe → sintética); guard impede sintética com movimento preso.',
        status: 'PRONTO',
        ref: '#77/#85',
      },
      {
        titulo: 'Plano de contas do operador: saldos, razão e lançamento manual',
        descricao: 'Saldos por natureza com roll-up do balancete e "saldo em <data>" (#81); razão da conta drill-down (#82); lançamento contábil manual em partida dobrada (#84).',
        status: 'PRONTO',
        ref: '#81/#82/#84',
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
        descricao: 'Empenho → liquidação → pagamento (via Compras), consulta de saldo com roll-up (#61), créditos adicionais (#62) e arrecadação da receita com estorno e previsto × arrecadado (#71).',
        status: 'PRONTO',
        ref: '#61/#62/#71',
      },
      {
        titulo: 'Contas bancárias (Febraban) × fontes de recurso',
        descricao: 'Cadastro Febraban (banco/agência/conta com DV) vinculado à fonte por código; emissão de OP só paga por conta ativa da fonte do empenho.',
        status: 'PRONTO',
      },
      {
        titulo: 'Fluxo de aprovação da LOA',
        descricao: 'Status RASCUNHO → ENVIADO_AO_LEGISLATIVO → APROVADO → PUBLICADO → EM_EXECUCAO com trilha auditável (de/para, autor, observação, data); execução travada por status.',
        status: 'PRONTO',
        ref: '#116',
      },
      {
        titulo: 'Abertura do exercício (PCASP) — contabiliza a LOA',
        descricao: 'Lança a previsão (D 6.2.1.1.0 / C 5.2.1.1.1) e a fixação (D 5.2.2.1.1.01 / C 6.2.2.1.1) + transporte dos saldos do ano anterior; idempotente e reversível.',
        status: 'PRONTO',
        ref: '#110',
      },
      {
        titulo: 'Acumulado diário (contábil, receita e despesa)',
        descricao: 'Saldo contábil por conta × dia materializado (#112); arrecadado × previsto/dia (#113) e empenhado/liquidado/pago/dia vs fixado (#115) lidos direto do ledger datado.',
        status: 'PRONTO',
        ref: '#112/#113/#115',
      },
      {
        titulo: 'Integração bancária CNAB — remessa de pagamentos',
        descricao: 'Conciliação por retorno (CSV/OFX/CNAB 240) já entregue (ver Contábil — Integração); falta gerar arquivos de REMESSA de pagamento (CNAB 240/400).',
        status: 'A_FAZER',
      },
    ],
  },
  {
    nome: 'Contábil — Integração automática (Tabela de Eventos)',
    icone: 'arrow-left-right',
    descricao: 'Cada fato orçamentário/financeiro gera lançamentos PCASP em partida dobrada, configurados por tabela editável no admin.',
    itens: [
      {
        titulo: 'Receita → contabilidade (E100/E200/E300)',
        descricao: 'Arrecadação dispara orçamentário, DDR e patrimonial (caixa pela conta bancária); conta-corrente como dimensão; receita não-efetiva (E400/E500); trilha mão-dupla.',
        status: 'PRONTO',
        ref: '#90/#91/#92/#93',
      },
      {
        titulo: 'Receita tributária (lançamento, dívida ativa, multas)',
        descricao: 'Reconhecimento por competência (E550), baixa na arrecadação (E560), inscrição em dívida ativa (E570) e multas/juros; baixa parcial controlada.',
        status: 'PRONTO',
        ref: '#95/#97/#98',
      },
      {
        titulo: 'Despesa → contabilidade (E600/E700/E800)',
        descricao: 'Empenho, liquidação (com perna patrimonial) e pagamento (perna financeira pela conta bancária) na mesma transação; cc = dotação; estorno inverte D↔C.',
        status: 'PRONTO',
        ref: '#109/#114',
      },
      {
        titulo: 'Tabela de Eventos editável + regras PCASP',
        descricao: 'As contas D/C de cada evento vêm de tabela no admin (não do código): máscaras PCASP + tokens resolvidos no disparo, gatilho explícito e validação PCASP (analítica, D=C, subsistema) no save.',
        status: 'PRONTO',
        ref: '#114',
      },
      {
        titulo: 'Conciliação bancária',
        descricao: 'Casa o extrato (CSV/OFX/CNAB 240) com as arrecadações 1:1; auto-match por valor + data; import por arquivo no navegador.',
        status: 'PRONTO',
        ref: '#94/#96',
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
      {
        titulo: 'Picker de view/colunas no editor de query',
        descricao: 'Escolher uma view rel_* e marcar colunas para montar o SELECT sem digitar SQL.',
        status: 'PRONTO',
      },
      {
        titulo: 'Totais configuráveis por coluna',
        descricao: 'Soma/média/contagem/menor/maior por coluna, uma linha rotulada por agregação (rótulo editável); subtotal de página opcional. Configurável no design do relatório e na prévia.',
        status: 'PRONTO',
      },
      {
        titulo: 'Formatação rica de cabeçalho/rodapé',
        descricao: 'Fonte, tamanho, negrito/itálico/sublinhado e alinhamento por elemento; réguas no editor; brasão redimensionável.',
        status: 'PRONTO',
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
