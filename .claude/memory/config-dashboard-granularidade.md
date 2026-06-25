---
name: config-dashboard-granularidade
description: Configuração do dashboard por entidade — granularidade dos planos (padrão modelo × desdobrado local) nos painéis (PR
metadata: 
  node_type: memory
  type: project
  originSessionId: bebb6b7f-4392-45b6-8ab4-efdcefb3872a
---

Configuração do dashboard por entidade (PR #99, `feat/config-dashboard-granularidade-plano`).
Escolha entre exibir o **plano padrão (modelo)** ou **com os desdobramentos locais** nos painéis.

- Modelo `ConfiguracaoDashboard` (`configuracoes_dashboard`, `entidadeId @unique`,
  `granularidadePlano` enum `GranularidadePlano` PADRAO|DESDOBRADO, **default DESDOBRADO**).
- `ConfiguracaoDashboardService.granularidade(entidadeId)` (DESDOBRADO se sem config) /
  `definir`. Helper `aplicarGranularidade(itens, g)`: em PADRAO filtra `origem!=='DESDOBRAMENTO'`.
- **Semântica**: PADRAO = colapsa os desdobramentos locais na conta-modelo. Os valores já
  sobem por roll-up (a árvore agrega leaf→ancestral, agnóstica a origem), então **os totais
  não mudam** — só esconde as linhas DESDOBRAMENTO. DESDOBRADO = árvore local completa (atual).
- **Painéis afetados** (todos que exibem os planos): Plano de Contas/Balancete + Plano
  Receita/Despesa (via `registrarRotasPlano` em `src/app/plano-entidade.ts` — filtra `contasVisiveis`,
  mas a estrutura temFilhos usa a árvore completa), Saldo Orçamentário (`/orcamento/saldo`) e
  Arrecadação (`/orcamento/arrecadacao`) — filtram `porConta`. `LinhaSaldo`/`LinhaArrecadacao`
  ganharam `origem`. Tela `/app/configuracao` + item no menu + badge "Plano padrão" nos painéis.
- **Caveat**: gerenciar desdobramentos (desdobrar/excluir contas locais) exige o modo DESDOBRADO
  — em PADRAO essas linhas ficam ocultas. Relatórios (SQL custom) e razão não entram no filtro.

**Refino PR #100 — seletor por relatório + memória ESPARSA:** cada painel tem um seletor na
tela (partial `_seletor-granularidade`, só aparece se há desdobramento) que manda `?g=PADRAO|
DESDOBRADO`. Modelo `PreferenciaRelatorioPlano` (entidade×relatorio @unique) guarda override
**esparso**: `definirRelatorio` grava só se difere do default da entidade; se a escolha volta ao
default, DELETA o override (centenas de relatórios, maioria segue o default — não enche a tabela).
`granularidadeRelatorio` = override do relatório → default da entidade (#99) → DESDOBRADO. A chave
`relatorio` é a rota (ex.: "/contas", "/orcamento/saldo"); escala p/ relatórios futuros por id.
