---
name: Estado do Projeto Gênesis
description: O que já foi implementado, o que falta, e decisões técnicas tomadas
type: project
originSessionId: 9fa83edc-4dde-4e46-a383-cf51b57cffad
---
## O que está pronto

**Infraestrutura:**
- 5 migrations aplicadas: `init_schema`, `add_senha_hash`, `lixeira_e_ordem_modulo`, `add_favorito_item`, `add_referencia_item` (atalhos entre itens via `referenciaId`)
- Plugin Prisma com driver adapter `pg` + `PrismaPg` (exigido pelo Prisma 7)
- Fastify com `tsx` como runner de dev (sem `--watch` — restart manual)
- `src/errors.ts` — `ErroNegocio`, `erroHttp`, `statusDeErro`, `tratarErro` compartilhados

**CRUD completo (API REST):**
- Sistemas, Módulos, Menus, Itens de Funcionalidade
- Usuários (CPF validado, CPF XOR idEstrangeiro)
- Códigos de Validação / MFA
- AdminSistema + AdminModulo (trava mínimo 1 ativo)
- PermissaoAcesso por usuário + item
- RelatorioFixo + RelatorioPersonalizado
- PastaFavorito (aninhada) + FavoritoRelatorio

**Painel Admin (HTML/EJS + HTMX) — COMPLETO:**
- Todas as telas CRUD (sistemas, módulos, menus, itens, usuários, permissões, relatórios fixos/personalizados, favoritos, lixeira, dashboard) + tela "funcionando" (sidebar de menus por sistema + favoritos de itens/relatórios)
- Splitpane árvore para hierarquias; modais para entidades simples
- Breadcrumbs em todas as telas admin + drill-in para sub-itens
- Drag-and-drop SortableJS na árvore: reorder, cross-container, modifiers com prioridade `Shift > Alt > Ctrl` (forçar mover / atalho / copiar), Esc cancela, validação de profundidade, cursor `not-allowed` + indicador "Bloqueado" em drag inválido
- Confirmação destrutiva unificada: interceptor `htmx:confirm` em `main.ejs` lê `data-confirm-{titulo,tipo,ok,destaque,detalhe}` do elemento
- Dirty tracking para modal (`_modalDirty`) e painel (`_painelDirty`) com aviso de alterações não salvas

**Fluxo de ativação — COMPLETO e TESTADO:**
- Registro → gera código EMAIL + CELULAR simultaneamente
- Validação em dois passos via nodemailer (Gmail) + Twilio SMS (com fallback mock)
- Login bloqueia acesso quando `emailValidado=false` (mesmo com `ativo=true`) e redireciona para `/admin/ativar/:id`
- Validação de e-mail/celular é **exclusivamente** por código enviado ao usuário — não há rota que marque `emailValidado`/`celularValidado` manualmente
- Admin em `/admin/usuarios` clica em "Enviar e-mail de validação" → dispara `CodigosService.solicitar` → usuário recebe link (`${BASE_URL}/admin/ativar/:id?passo=EMAIL`) + código 6 dígitos; só o submit do código correto em `/admin/ativar/:id` altera o estado
- `.env.example` exige `BASE_URL` para montar o link

**Sistema Contábil (Spec 2026-05-21) — IMPLEMENTADO e testado:**
- `ModeloContabil` (admin com toggle ativo; novo nasce ativo por default — fix PR #10)
- `Estado` (27 UFs fixas, atribuir modelo via modal "Aplicar")
- `Município` (atribui modelo, herda do estado se vazio)
- `PlanoDeContas` (1 por modelo × ano, com botão Importar CSV)
- `Conta` (árvore HTMX com expansão preguiçosa, `admiteMovimento`)
- `Lançamento` (partida dobrada, itens dinâmicos, lookup HTMX de contas filtrado por plano vigente, validação client-side D=C, unicidade D+C apenas avisa)
- Lookup offcanvas pattern: `src/admin/lookup.ts` + `src/views/lookup/{usuarios,contas}.ejs` + `rows_*.ejs`

**Design System Wise — aplicado:**
- `DESIGN.md` versionado com paleta + tokens (ink #0e0f0c, lime #9fe870, sage #e8ebe6, Manrope+Inter)
- `src/views/layouts/_theme.ejs` (204 linhas) — override Bootstrap via CSS custom properties, zero alteração de markup nas 60+ views
- Mockup standalone em `mockups/design-system.html`
- Gotcha: `.text-primary` é remapeado para `var(--ink)` (memória [[text-primary-remapeado-no-tema]])
- Regra de cor: **lime SÓ para CTA**; ink para texto brand; sage para neutro
- Inspeção visual local: não há mais seeds versionados (os `seed_*_temp.ts` foram removidos no PR #16). Para popular o banco, criar admin + fixtures contábeis ad-hoc via `npx tsx -e` usando os services. O banco local já tem fixtures contábeis (PR/Curitiba → plano PCASP 2026 → 9 contas → 3 lançamentos) persistidas.

**Testes (Vitest) — ~2654 testes, cobertura 100% no código novo:**
- Testes ficam em `src/{admin,routes,services}/__tests__/*.test.ts` — **NÃO** em `tests/` (a CLAUDE.md global menciona pytest/`tests/`, mas é genérica; ignorar para o Gênesis)
- Padrão: cada módulo tem `X.test.ts` + frequentemente um `X-extras.test.ts` (testes extras criados só para fechar branches restantes)
- Esforço concluído em mai/2026: ~40 commits levando cobertura de linhas **e branches** de cada arquivo a 100%
- E2E com Playwright em `e2e/` (drag-and-drop com prioridade de modifiers)
- Helper `prisma-mock.ts` com `$transaction` suportando array e callback (interactive)
- `vitest.config.ts` exclui `dist/` para evitar duplicação de testes compilados
- Rodar: `npm test` (= `vitest run`, tudo mockado, sem DATABASE_URL); cobertura: `npm run test:coverage`; e2e: `npm run test:e2e`

**CI (GitHub Actions):**
- `.github/workflows/ci.yml` dispara em push para master e PRs
- Steps: checkout → setup-node@v4 (Node 24, cache npm) → `npm ci` → `npx prisma generate` → `npm test`

**Tipo de item (formulário) — auto-preenchido por contexto:**
- Filho de MENU (profundidade=0) → select com FUNCIONALIDADE/SUBMENU
- Filho de SUBMENU (profundidade≥1) → travado em FUNCIONALIDADE
- Server-side bloqueia SUBMENU em profundidade ≥1

## Estado atual (consolidado 2026-06-08 — todas as sessões paralelas encerradas)

**Área do operador `/app` (multi-entidade × exercício) — COMPLETA:** login próprio (`/app/login`, cookie `genesis_user_token`) + escolha de contexto (`/app/contexto`, cookie `genesis_exercicio`=`entidadeId:ano`) + dashboard. Middlewares `appAuthMiddleware`+`appContextoMiddleware`; `req.contexto.{entidadeId,ano,nivel}` (nível via `AcessoEntidade`). Áreas escopadas: Orçamento (+ saldo `/app/orcamento/saldo` com roll-up #61 + créditos adicionais `/app/orcamento/creditos` #62), Lançamentos, Plano de Contas, Compras (read-only, 3 fases: C-App-1 catálogo/PCA/DOD/Reservas + C-App-2/3 fornecedores/processos/contratos/atas/empenhos/liquidações/OPs — #59), Relatórios. Link cruzado admin↔app (#48).

**Permissão por entidade — COMPLETA:** `AcessoEntidade` (usuário×entidade×nível LEITURA/ESCRITA/ADMIN) + UI admin (#32/#33).

**Módulo Compras Públicas (Lei 14.133) — admin COMPLETO:** stack planejamento⊂seleção⊂execução (#35/#36/#38), 11 telas (documentos-demanda, itens-catalogo, planos-contratacao, reservas-dotacao, atas, fornecedores, processos, contratos, empenhos, liquidacoes, ordens-pagamento). Importação de catálogo CATMAT via CSV no admin (#52); 162.919 itens no banco dev.

**Planos de contas 2026 — COMPLETOS no banco dev (2 modelos) + tooling em `scripts/`:** modelo **PARANÁ/TCE-PR**: Contábil PCASP Estendido 8.760 (#46, `NIVEL_MAX=9`), Receita 1.808, Despesa 3.902 (#47). modelo **PCASP Rondônia** (2026-06-09): os 3 planos importados — Contábil 8.760 (atributos PCASP entram no próprio import, sem backfill), Receita 1.808, Despesa 3.902. **PROVISORIAMENTE IDÊNTICO AO PARANÁ** (reusa os CSVs do PR). Greenfield. Estado RO vinculado. **⏳ Marco vai padronizar a fonte RO específica e mandar depois** — aí re-importar receita/despesa do RO. Decisões: receita usa descrição CURTA `dsDesdobramento` (NÃO Especificação) nos dois modelos. **Ressalva p/ quando voltar:** os arquivos STN "Padrão" no `~/Downloads` (`Plano de Contas Padrao da Receita 2026`, `...Despesa Orcamentaria 2026`) têm gaps — receita STN=662 contas mas **11 níveis agregadores faltantes** (ramos 1.2.1.5/1.2.2.1/1.3.4.3/1.6.3.2/1.7.1.1) + 1 código malformado; despesa STN=907 limpa. Converter STN: cabeçalho na **linha 3** (≠ TCE-PR linha 7); receita cod=col 11/desc=13/nível=14, despesa cod=6/desc=8/nível=9.

**Plano de contas — modelo↔entidade (#55):** **sincronização automática modelo→entidades** no save (criar/editar/excluir conta dos 3 planos + fontes; bloqueia se há desdobramento abaixo ou fonte em uso; atômico) — `src/services/sincronizador-contas.ts`. **Toda conta nasce ANALÍTICA** (admite movimento); vira sintética ao ganhar o 1º filho e volta a analítica ao perder o último — invariante `admiteMovimento ⟺ sem filhos`, nos 3 planos e nas cópias da entidade. **Excluir desdobramento** na árvore da entidade (só `origem=DESDOBRAMENTO`; cópias MODELO são geridas no plano-modelo; reverte o pai). Atalho **"Planos ▾"** na lista de modelos. **Brasão/logotipo da entidade (#56):** upload (PNG/JPG/GIF/WEBP ≤1 MB, data URL) no cadastro reusando `Entidade.brasao` que o gerador de relatórios já consome (elemento `BRASAO`).

**Gerador de Relatórios (`/app`) — COMPLETO:** templates de cabeçalho/rodapé (editor WYSIWYG), relatórios com query SQL em **sandbox isolado por entidade** (role read-only `genesis_report_ro` + views `rel_*` + GUC `app.entidade`), prévia HTML, organização em pastas, **exportação em 8 formatos** (HTML/TXT/PDF/CSV/XLS/DOC/XML/JSON; deps `exceljs`/`docx`) (#53), **total geral + total por página automáticos** (#54). Fixes: nome único (#49), prefixo `/app` no form do editor (#51). Ver [[relatorios-gerador-plano]].

**Painel de Escopo (#57, gap #1):** `/admin/escopo` — visualização HTML do roadmap (o que é o sistema, o que foi feito, o que falta) com KPIs + barra de progresso + seção por área com badges de status. Fonte da verdade = **arquivo versionado tipado** `src/services/escopo.ts` (áreas × itens × status PRONTO/EM_ANDAMENTO/A_FAZER + ref de PR) + `resumirEscopo()`. **Atualizar `src/services/escopo.ts` no mesmo PR de cada feature nova** (o painel acompanha o código). Link "Escopo" na sidebar. Sem banco, sem CRUD.

## O que falta (backlog priorizado — candidatos a "próxima funcionalidade")

1. **Execução orçamentária (gap #5) — EM ANDAMENTO (3 PRs).** Fluxo empenho→liquidação→pagamento já existe (via Compras, com saldo materializado em `DotacaoDespesa.valor{Autorizado,Reservado,Empenhado}` e dedução transacional nos services de reserva/empenho). ✅ **PR-1 #61**: consulta read-only de saldo `/app/orcamento/saldo` (`src/services/saldo-orcamentario.ts` — resumo + agregações por UO/fonte/função + por conta com roll-up na árvore). ✅ **PR-2 #62**: créditos adicionais (`CreditoAdicional`+`CreditoAdicionalItem`; suplementar/especial/extraordinário; reforço/anulação; aplicação imediata no `valorAutorizado`; `/app/orcamento/creditos`; `src/services/creditos-adicionais.ts`). ⏳ **PR-3 (falta)**: arrecadação da receita (previsão→arrecadado; precisa schema — `PrevisaoReceita` só tem valorPrevisto). Ver [[contabil-regras-orcamentario]].
2. ~~Compras no `/app` — C-App-2 (Seleção) e C-App-3 (Execução)~~ ✅ **FEITO read-only** (PR #59): 7 telas de consulta (fornecedores/processos/contratos/atas + empenhos/liquidações/OPs) escopadas ao contexto, hub em 3 fases. Reusa só `listar` dos services; criação/edição segue no /admin. Ver [[compras-no-app-plano]].
3. ~~Sync modelo→entidades (gap #2)~~ ✅ **FEITO** (PR #55, `src/services/sincronizador-contas.ts`): criar/editar/excluir conta-modelo (contábil/receita/despesa) + fontes propaga p/ as cópias `origem=MODELO` no save (atômico); bloqueia se há desdobramento abaixo. Sem migração.
4. ~~Atributos PCASP no plano (gap #4)~~ ✅ **FEITO** (PR #60): enums NaturezaInformacao/NaturezaSaldo/SuperavitFinanceiro + funcao em `Conta` (só plano-modelo) + importador estendido + `scripts/backfill_pcasp_atributos_2026.ts` (rodado no dev: 8760 contas) + coluna "Natureza (PCASP)" na árvore. Dados da planilha TCE-PR.
5. ~~Dashboard HTML de escopo (gap #1)~~ ✅ **FEITO** (PR #57, `/admin/escopo` + `src/services/escopo.ts`). Lembrar de atualizar o roadmap a cada feature.

## Decisões técnicas importantes

- Prisma 7 exige `driverAdapters` em `previewFeatures` e `new PrismaClient({ adapter })`
- Em Prisma 7 com driver adapter, `datasource db` no schema.prisma não precisa de `url` — `prisma generate` roda sem DATABASE_URL
- Runner de dev é `tsx` (sem watch — restart manual após mudança em .ts)
- `exactOptionalPropertyTypes: true` no tsconfig
- SortableJS com `forceFallback:true` (necessário para handle em `<button>`); ler `evt.originalEvent.ctrlKey` no onEnd é inconsistente — usar variável `_ddCtrlAtivo` mantida por keydown/keyup
- Testes mockam `email.js`/`sms.js` (nodemailer + Twilio) para não vazar para SMTP real
- `FavoritoItem` voltou ao schema (migration `20260506182330_add_favorito_item`) — favoritos de item por sistema
- Itens podem ter `referenciaId` → "atalho" para outro item; `criarAtalho()` em `ItensService` (não permite atalho de atalho)
- Feedback ao admin via `HX-Trigger: {"mostrarInfo": {titulo, texto}}` — handler em `main.ejs` exibe modal informativo (semCancelar)
- Em `admin/menus.ts`: helpers `render{Sistema,Modulo,Menu,Item}Edit(reply, id, erro)` para re-render após erro; constante `HX_REFRESH_TREE`; helper `errMsg(e, fallback)`
- **Guard de fragmentos** (`admin/index.ts`): GET não-HTMX com ≥2 segmentos é tratado como fragmento e redirecionado pra `/admin`. Página **completa** (renderizada com `layout: main`) sob caminho profundo (ex.: `/lancamentos/novo`) precisa entrar no Set `PAGINAS_COMPLETAS_PROFUNDAS`, senão o `<a href>` cai no dashboard. Exceção blanket: tudo sob `funcionando/*`.

**Why:** Stack escolhida para programador COBOL veterano — tipagem forte, schema declarativo.
**How to apply:** Continuar padrões service/route. Admin splitpane para hierarquias, modal para entidades simples. Para confirmações destrutivas use `data-confirm-*`. Ao criar/editar service crítico, criar `X.test.ts` correspondente e manter 100% de cobertura.
