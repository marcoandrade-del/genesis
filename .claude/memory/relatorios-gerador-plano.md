---
name: relatorios-gerador-plano
description: "Gerador de relatórios (/app): decisões da spec + plano de 3 PRs. R1 = cabeçalho/rodapé + editor WYSIWYG"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7655609f-074d-4624-ac8a-6f0d23463aa9
---

Spec `data/Specs Gerador de relatórios.txt`: usuário cria relatórios (escreve query SQL), escolhe cabeçalho/rodapé de templates, organiza num menu "Meus Relatórios". Trabalho iniciado 2026-06-03.

## Decisões fechadas (perguntei tudo antes — spec exige)
- **Local:** área `/app` (operador logado), usa `req.contexto.{entidadeId,ano}`.
- **Escopo dos templates e do "Meus Relatórios":** por **ENTIDADE** (não por sistema — NÃO há vínculo Usuario↔Sistema nem Entidade↔Sistema no schema; o contexto do /app é só entidade+ano).
- **Query:** SQL livre, sandbox: conexão/role read-only dedicada, allowlist de tabelas/views, validação SELECT-único, timeout. Placeholders `:entidadeId`/`:ano` bindados no servidor (operador nunca escolhe entidade na query).
- **Saída:** preview HTML + Exportar PDF (Playwright, já no projeto — `page.pdf` com header/footerTemplate dá repetição+numeração).
- **Layout cabeçalho/rodapé:** editor WYSIWYG, posicionamento livre x/y (não SortableJS). Guardar como `layout Json`.
- **Brasão da entidade:** base64 (data URL) em `Entidade.brasao`. Também add `Entidade.endereco`.
- **Modelo de dados:** estender `RelatorioPersonalizado` (add entidadeId, query, cabecalhoId?, rodapeId?); NÃO criar modelo novo.
- **Meus Relatórios:** reusar `PastaFavorito` (add entidadeId) + `FavoritoRelatorio` (já liga pasta↔relatório).
- **Templates "operador cria":** compartilhados na entidade; guardar `criadoPorId` p/ audit. Escrita exige nível ESCRITA/ADMIN (LEITURA só vê/usa).

## Faseamento (3 PRs)
- **R1 (em andamento, branch `feat/relatorios-cabecalho-rodape`):** Entidade.brasao/endereco + modelos `CabecalhoRelatorio`/`RodapeRelatorio` (entidadeId, criadoPorId, nome, layout Json, altura, ativo) + CRUD `/app/relatorios/{cabecalhos,rodapes}` com editor WYSIWYG + ativar card "Relatórios" no dashboard. Tipos de elemento — cabeçalho: BRASAO, NOME_ENTIDADE, DATA_GERACAO, HORA_GERACAO, NUMERO_PAGINA, NOME_RELATORIO; rodapé: NUMERO_PAGINA, DATA_GERACAO, HORA_GERACAO, ENDERECO_ENTIDADE.
- **R2 (FEITO — branch `feat/relatorios-relatorio-query`, empilhado no R1):** RelatorioPersonalizado + query/entidadeId/cabecalhoId/rodapeId (opcionais, sem quebrar CRUD admin); migração `20260603140000` (colunas + views `rel_*` filtradas por `current_setting('app.entidade')` — comparar TEXT, NÃO `::uuid`, pois Prisma guarda id como text); `RelatorioExecutor` (pool read-only `REPORT_DB_URL`, BEGIN READ ONLY + statement_timeout + set_config app.entidade + validarQuery SELECT-único + placeholders :entidadeId/:ano + cap 500 linhas); `MeusRelatoriosService` (CRUD por usuário+entidade); telas `/app/relatorios/meus` (hub + editor + executar→preview). `prisma/sql/report_role.sql` + REPORT_DB_URL no .env.example. 67 testes novos, 100% cov, suíte 2415 verde. Isolamento por entidade = **views filtradas** (decisão do Marco; placeholders sozinhos NÃO isolam). **PR #43 aberto** (base = #42; retarget p/ master quando #42 mergear). **Verify real feito** (preview com 3 lançamentos de Curitiba, isolamento provado: outra entidade=0 linhas). Fix de data pt-BR no preview pushado (f969ec8). **Role read-only AINDA NÃO criada**: usuário do app `mandrade1965` NÃO tem CREATEROLE (e `postgres` exige senha/sudo) → Marco precisa criar como superusuário: `sudo -u postgres psql -d genesis -f prisma/sql/report_role.sql` e setar `REPORT_DB_URL`. Em dev coloquei `REPORT_DB_URL`=DATABASE_URL no `.env` (gitignored) como fallback — isolamento pelas views funciona, mas falta a barreira de a role não ler tabelas-base.
- **R3 (FEITO — branch `feat/relatorios-pastas`, empilhado no R2; commit 06ca50d, NÃO pushado):** PastaFavorito+entidadeId (opcional); `MeusRelatoriosOrgService` (árvore aninhada por usuário+entidade reusando PastaFavorito/FavoritoRelatorio; criar/renomear/excluir pasta + atribuir relatório); hub vira árvore (partials recursivos `_relatorios-pasta.ejs`/`_relatorios-linha.ejs`) + seletor de pasta; **Exportar PDF server-side** (Marco trocou p/ opção 2 = **Playwright dep de runtime**): `relatorio-pdf.ts` (montarTemplateFaixa/montarCorpoHtml/margemParaFaixa puros + `gerarPdf` glue istanbul-ignored) → page.pdf com header/footer nas margens (repetidos) + pageNumber/totalPages nativo. Migração `20260603160000`. 68 testes novos, 100% cov, suíte 2461 verde. **PDF verificado real** (A4 com os 3 lançamentos de Curitiba).
  - ✅ STACK RESOLVIDA: R1 (#42) squash-merged em master (ab595a9). Rebaseei a stack: `git rebase --onto origin/master c45c88d` (R2) + `--onto R2 f969ec8` (R3), zero conflito. **#43 (R2) retargetado→master via REST** (`gh api repos/.../pulls/43 -X PATCH -f base=master`; `gh pr edit --base` falha por Projects-classic). **#43 (R2) MERGED em master.** R3 rebaseado `--onto origin/master 6e9d615` sobre master 0e5cb90 (commit cb1d068), force-pushed; **#44 retargetado→master por REST**; suíte 2475 verde, tsc limpo. **✅ #44 (R3) MERGEADO em master (77eeb32). GERADOR DE RELATÓRIOS COMPLETO — as 3 fases (#42/#43/#44) em produção.** Deploy em DEV CONCLUÍDO (2026-06-03): chromium já no cache `~/.cache/ms-playwright/chromium-1223`; role `genesis_report_ro` criada por Marco como superusuário (`sudo -u postgres psql -d genesis -f /tmp/report_role_local.sql`, senha gerada por mim e casada com `REPORT_DB_URL` no `.env` gitignored; arquivo /tmp removido depois). **Isolamento VERIFICADO ao vivo conectado COMO a role:** lê `rel_lancamentos` (3 linhas Curitiba) mas leva `permission denied` em `lancamentos`/`entidades` e em qualquer DELETE/UPDATE; view é fail-closed sem contexto (0 linhas) e cross-entity=0. Para PRODUÇÃO repetir: `npx playwright install chromium` + rodar `prisma/sql/report_role.sql` (TROCAR a senha placeholder) + setar `REPORT_DB_URL`. Worktree `/home/marco/claude/genesis-relatorios` REMOVIDO e branches locais R1/R2/R3 APAGADOS (limpeza feita a pedido do Marco). Frente encerrada. Ver [[merge-stack-squash-x-ours]].

## Pós-merge — fix de integridade na gravação de templates (2026-06-03, ✅ PR #49 MERGEADO `222067d`)
Auditoria da gravação de cabeçalhos/rodapés (verify real contra DB dev) achou 4 gaps; corrigidos e **mergeados em master** (squash `222067d`, CI verde; branch `fix/relatorios-template-nome-unico` apagada):
- **#1 (médio):** nome duplicado gravava sem bloqueio → `@@unique([entidadeId, nome])` nos 2 models (migração `20260603170000`, aplicada no dev sem drift) + `comNomeUnico()` no service traduz `P2002` → `ErroNegocio` "Já existe um cabeçalho/rodapé com esse nome nesta entidade."
- **#2 (baixo):** layout vazio `[]` gravava (faixa fantasma) → `validarLayout` agora exige ≥1 elemento.
- **#4 (baixo):** re-render de erro com `altura:''` colapsava o canvas → fallback `Number(...)` no editor EJS.
- **#3:** `layout:null` passado às views é inerte (local EJS ignorado) — deixado, não é bug.
+5 testes no service (vazio rejeita, P2002 traduzido nos 2 bands + update, erro não-P2002 propaga); suíte **2480 verde**.

Migração: seguir [[prisma-migrate-drift-genesis]] (diff+db execute+resolve, sem reset) e [[prisma-generate-apos-migrate]]. Padrões: [[project_estado]], testes mockados.

## Estado do R1 (2026-06-03) — RESTACK FEITO sobre master+Compras; implementado e TESTADO; falta só commit/PR
**ONDE:** worktree isolado `/home/marco/claude/genesis-relatorios` (branch `feat/relatorios-cabecalho-rodape`, baseado em master 8a79735). NÃO é o dir compartilhado `/home/marco/claude/genesis` (esse voltou para `feat/compras-execucao` da sessão Compras). Motivo do worktree: sessões compartilham um único checkout e colidiram — meu branch nasceu por engano sobre Compras (sem /app). Backup do trabalho em `/tmp/relatorios-r1-backup/`.

**PRONTO (compila limpo, `tsc --noEmit` 0 erros reais):**
- schema: `Entidade.brasao`(@db.Text base64)+`endereco`; modelos `CabecalhoRelatorio`/`RodapeRelatorio` (entidadeId, criadoPorId, nome, altura, layout Json, ativo) + back-relations.
- migration `prisma/migrations/20260603100000_add_cabecalho_rodape_relatorio` (já aplicada+resolvida no banco dev COMPARTILHADO via diff+db execute+resolve; só aditivo).
- `src/services/cabecalhos-rodapes.ts` (CRUD + validação de layout: allowlist de elementos por faixa, tipo único, x/y 0–100, altura 40–400; guard de entidade multi-tenant).
- `src/app/relatorios.ts` (hub + editor CRUD genérico cabeçalho/rodapé; escrita exige ESCRITA/ADMIN; LEITURA só lista). Registrado em `src/app/index.ts`.
- `prisma-mock.ts`: delegates `cabecalhoRelatorio`/`rodapeRelatorio` (add no fim, antes de $transaction).
- dashboard: card "Relatórios" ativado → `/app/relatorios`.
- views: `src/views/app/relatorios.ejs` (hub) + `relatorios-editor.ejs` (editor WYSIWYG, posicionamento livre x/y % via pointer events, preview com brasão/nome/data/hora/página/endereço; DOM via textContent, DADOS inline JSON com `</` escapado).

**RESTACK CONCLUÍDO (2026-06-03):** worktree fast-forwardado para origin/master `8a205a2` (Compras dentro). Conflitos resolvidos: `schema.prisma` (Entidade: mantidas relations Compras + minhas; UnidadeOrcamentaria/DotacaoDespesa: ficou com upstream Compras) e `prisma-mock.ts` (mantidos delegates Compras + meus cabecalhoRelatorio/rodapeRelatorio antes de $transaction). `prisma generate` ok, schema válido, `tsc --noEmit` 0 erros reais.

**TESTES (2026-06-03):** `src/services/__tests__/cabecalhos-rodapes.test.ts` + `src/app/__tests__/relatorios.test.ts` (63 testes). **Cobertura 100%** stmts/branches nos dois arquivos. Suíte completa **2348 testes verdes** (160 arquivos). Sem prettier/eslint no projeto.

**R1 CONCLUÍDO:** commit + push + **PR #42 aberto** contra master (https://github.com/marcoandrade-del/genesis/pull/42). Branch `feat/relatorios-cabecalho-rodape`. Próximo: R2 (estender RelatorioPersonalizado + sandbox query + preview HTML). Opcional ainda: verify manual do editor no app (cookie-auth, ver [[rodar-app-admin]]).

## ✅ FRENTE CONCLUÍDA (2026-06-08) — tudo em master, validado em browser pelo Marco
Sequência final em produção: **#42/#43/#44** (R1 cabeçalho-rodapé / R2 query-sandbox-preview / R3 pastas-PDF) → fixes **#49** (nome único `@@unique(entidadeId,nome)` + layout≥1) e **#51** (form do editor com prefixo `/app`; testes mascaravam) → **#53** exportação em 8 formatos (HTML/TXT/PDF/CSV/XLS/DOC/XML/JSON; `relatorio-export.ts` + deps `exceljs`/`docx`; menu `<details>` na prévia) → **#54** total geral + total por página automáticos (`relatorio-totais.ts`: coluna de valor c/ heurística de código zero-à-esquerda, soma sem ruído de float, paginação A4, rótulo sempre visível; total em todos os formatos, subtotal por página no PDF/prévia). Arquivos do cluster: `relatorio-{executor,pdf,export,totais}.ts`, `meus-relatorios{,-org}.ts`, `cabecalhos-rodapes.ts`, `src/app/relatorios.ts`, `src/views/app/relatorios*.ejs`. **Deploy (1x por ambiente):** `npx playwright install chromium` + role `genesis_report_ro` (`prisma/sql/report_role.sql`) + `REPORT_DB_URL` — já feito no dev.
