---
name: spec-usabilidade-2026-06-09
description: "Specs 09-06-2026 — melhorias de usabilidade/navegação (pivot do Marco: usabilidade antes de fechar gap #5). Fonte: data/Specs 09-06-2026"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7655609f-074d-4624-ac8a-6f0d23463aa9
---

Marco abriu nova frente em 2026-06-09 (`data/Specs 09-06-2026`): **melhorias de usabilidade/navegação**, porque "tá complicado testar a usabilidade". **Gap #5 PR-3 (arrecadação da receita) ficou PAUSADO** — retomar depois. Ver [[contabil-regras-orcamentario]], [[project_estado]].

## Itens (6 melhorias; item 4 já estava feito)
1. **/app com menus DINÂMICOS** (não fixos). Hoje a navegação do /app é hardcoded (cards em `src/views/app/dashboard.ejs` + sub-nav por área). O correto é usar o sistema de menus do core (Sistema→Módulo→Menu→Item). **Refazer**: semear as linhas necessárias nas tabelas de menu + **dar acesso a todos os usuários existentes** + renderizar o /app a partir do banco. Frente A.
2. **Relatórios — picker de view/campos.** Antes de digitar a query, o usuário escolhe uma view disponível (`rel_*` do sandbox) e o sistema sugere/monta os campos (gera `SELECT cols FROM rel_x` ou tabela de seleção de colunas). Facilita p/ leigo. Marco pediu minha opinião — **endossei** (reusa as views `rel_*` + `information_schema`). Frente C.
3. **Cabeçalho/rodapé — formatação rica + réguas + brasão.** Por campo: tipo/tamanho de fonte, negrito/itálico/sublinhado, alinhamento (esq/centro/dir). Adicionar **réguas** (posicionamento exato hoje é "olhômetro"). **Redimensionar o brasão** quando incluído no cabeçalho. Mexe no editor WYSIWYG `src/views/app/relatorios-editor.ejs` + no `layout Json` dos templates. Frente D.
4. ~~Acesso ao plano de contas por linha em modelos-contábeis~~ ✅ **JÁ FEITO (#55)** — dropdown "Planos ▾" em `src/views/modelos-contabeis/index.ejs`.
5. **Encadear navegação admin:** da tela **Estados** → municípios do estado → entidades do município (drill-down). Frente B.
6-8. **Planos por linha** em Estado/Município/Entidade: em cada linha, links p/ Plano de Contas / Receita / Despesa (consulta do padrão do estado; do município; e da entidade). Frente B (junto com o item 5).

## Frentes propostas (PRs)
- **A** — /app menus dinâmicos (refactor + seed + grant). ✅ **FEITO (#66)**: `MenuAppService.arvorePermitida` (itens ativos do Sistema `Gênesis · Operador` ∩ `PermissaoAcesso`) + `preHandler` injeta em `reply.locals.menuApp` (mesclado pelo `@fastify/view` em toda view, sem tocar rota) + `_navbar.ejs` vira menu com dropdowns (SUBMENU) + bundle Bootstrap; 5 áreas inline migraram p/ `include('_navbar')`; cards do dashboard dinâmicos. `seed-menu-app.ts` idempotente: 18 itens + grant VISUALIZAR a todos os usuários (encadeado em `prisma/seed.ts`). **Sem migração**. Decisões: dropdowns na navbar (não sidebar); menu inline (árvore fixa 2 níveis, sem partial recursivo); `VISUALIZAR` = só visibilidade (escrita continua via `AcessoEntidade`). Risco: usuário criado após o seed não ganha grant → conceder via `/admin/permissoes` ou re-rodar seeder. Feito em worktree isolado.
- **B** — navegação admin Estados→Municípios→Entidades + planos por linha (itens 5-8). ✅ **FEITO (#63)**: drill por linha (count municípios → `?estadoId=`; botão Entidades → `?municipioId=`) + dropdown "Planos ▾" por linha nos 3 níveis (estado/município = modelo via `?modeloContabilId=`, com herança no município; entidade = cópias via `?entidadeId=&ano=`). Pura view, reusou infra de filtro + dropdown do #55.
- **C** — relatórios: picker de view + colunas (item 2). ✅ **FEITO (#68 mergeado, squash `0b5d18d`)**: `RelatorioExecutor.listarViews()` (information_schema no sandbox read-only) + card no editor (`relatorios-relatorio-editor.ejs`): select de view `rel_*` → checkboxes de colunas → "Usar na query" gera o SELECT. Degrada sem picker se o sandbox falhar; sem migração.
- **D** — cabeçalho/rodapé: formatação + réguas + brasão (item 3). ✅ **FEITO (#70 mergeado, squash `74dd8ba`)** — **SPEC 09-06 100% ENTREGUE (A #66, B #63, C #68, D #70)**: fonte/tamanho/N/I/S/alinhamento (âncora do X) por elemento + réguas + painel de propriedades + brasão 16-200px; atributos opcionais no layout Json (sem migração); editor/prévia/PDF com as mesmas regras de estilo.
- *(extra, fora da spec)* ✅ **Totais configuráveis por coluna (#69, squash `840dcec`)**: soma/média/contagem/menor/maior por coluna, uma linha rotulada por agregação (rótulo editável), subtotal de página com toggle, painel na prévia; config em `configuracao.totais` (sem migração). Inclui fix do bug dos onsubmit (prompt/confirm mortos por aspas sem escape — ver [[ejs-json-em-atributo-de-evento]]).
