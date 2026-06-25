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
- `src/views/layouts/_theme.ejs` — override Bootstrap via CSS custom properties, zero alteração de markup nas views
- Gotcha: `.text-primary` é remapeado para `var(--ink)` (memória [[text-primary-remapeado-no-tema]])
- Regra de cor: **lime SÓ para CTA**; ink para texto brand; sage para neutro

**Testes (Vitest) — ~3088 testes, cobertura 100% no código novo:**
- Testes ficam em `src/{admin,routes,services,app}/__tests__/*.test.ts` — **NÃO** em `tests/` (a CLAUDE.md global menciona pytest/`tests/`, mas é genérica; ignorar para o Gênesis)
- Padrão: cada módulo tem `X.test.ts` + frequentemente um `X-extras.test.ts` (testes extras criados só para fechar branches restantes)
- E2E com Playwright em `e2e/` — **roda no CI** (job com Postgres + `e2e/seed.ts`, desde #76)
- Helper `prisma-mock.ts` com `$transaction` suportando array e callback (interactive) — 🔴 **zona de colisão** entre sessões (todo delegate novo é adicionado aqui)
- Rodar: `npm test` (= `vitest run`, tudo mockado, sem DATABASE_URL); cobertura: `npm run test:coverage`; e2e: `npm run test:e2e`

**CI (GitHub Actions):**
- `.github/workflows/ci.yml` dispara em push para master e PRs
- Steps: checkout → setup-node (Node 24, cache npm) → `npm ci` → `npx prisma generate` → `npm test`; job e2e separado com Postgres + Playwright
- ⚠️ `ci.yml` não tem `workflow_dispatch` → rebase/force-push não re-dispara CI; reabrir PR (`gh pr close && reopen`) força o evento ([[reabrir-pr-para-redisparar-ci]])

## Estado atual (consolidado 2026-06-25 — nenhuma frente ativa, tudo em master)

**Área do operador `/app` (multi-entidade × exercício) — COMPLETA:** login próprio (`/app/login`, cookie `genesis_user_token`) + escolha de contexto (`/app/contexto`, cookie `genesis_exercicio`=`entidadeId:ano`) + dashboard. Middlewares `appAuthMiddleware`+`appContextoMiddleware`; `req.contexto.{entidadeId,ano,nivel}`. **Navegação dinâmica** (#66): menus do /app vêm do menu do core. **Menu superior "Gênesis Command Bar"** (#79). **Área de Trabalho customizável**: barra de favoritos do operador estilo navegador (#102), painel reordenável por arrasto per-user (#105), finalização favoritos/layout/contexto (#107). **Config do dashboard** (#99/#100): granularidade dos planos padrão×desdobrado por entidade e por relatório (memória esparsa). Áreas escopadas: Orçamento, Lançamentos, Plano de Contas, Compras (read-only), Relatórios. Link cruzado admin↔app (#48).

**Permissão por entidade — COMPLETA:** `AcessoEntidade` (usuário×entidade×nível LEITURA/ESCRITA/ADMIN) + UI admin (#32/#33). Navegação encadeada Estado→Município→Entidade + planos por linha (#63); filtro "só ativas" (#64).

**Módulo Compras Públicas (Lei 14.133):** admin COMPLETO — stack planejamento⊂seleção⊂execução (#35/#36/#38), 11 telas; catálogo CATMAT via CSV (#52), 162.919 itens no dev. **No /app: read-only completo** (#45/#59) — catálogo/PCA/DOD/Reservas + fornecedores/processos/contratos/atas/empenhos/liquidações/OPs, escopado ao contexto.

**Planos de contas 2026 — COMPLETOS no banco dev (2 modelos):** modelo **PARANÁ/TCE-PR**: Contábil PCASP Estendido 8.760 (#46, `NIVEL_MAX=9`), Receita 1.808, Despesa 3.902 (#47); **atributos PCASP** (NaturezaInformacao/NaturezaSaldo/SuperavitFinanceiro + funcao) nas contas (#60). modelo **PCASP Rondônia**: os 3 planos importados, **PROVISORIAMENTE IDÊNTICO AO PARANÁ**. **⏳ Marco vai padronizar a fonte RO específica e mandar depois** — aí re-importar receita/despesa do RO. **Ressalva STN:** arquivos "Padrão" no `~/Downloads` têm gaps (receita STN=662 com 11 níveis agregadores faltantes; despesa STN=907 limpa). Converter STN: cabeçalho na **linha 3**; receita cod=col 11/desc=13/nível=14, despesa cod=6/desc=8/nível=9.

**Plano de contas — modelo↔entidade + desdobramento — COMPLETO:** **sincronização automática modelo→entidades** no save (#55, `src/services/sincronizador-contas.ts`; atômico, bloqueia se há desdobramento/fonte em uso). **Toda conta nasce ANALÍTICA**; vira sintética ao ganhar filho e volta ao perder o último (invariante `admiteMovimento ⟺ sem filhos`). **Desdobramento no /app** (#77) nos 3 planos + fix do código (preenche o 1º segmento ZERADO da máscara PCASP). **Desdobrar em vários filhos + editar descrição** (#83). **Desdobrar com DISTRIBUIÇÃO** (épico #85: #86 motor / #87 tela 3 fases / #88 guard): conta com saldo/movimento reaponta `LancamentoItem` com rateio, recompõe `ResumoMensalConta`/`SaldoInicialAno`, zera a mãe→sintética; guard impede sintética-com-movimento-preso. **Brasão/logotipo da entidade** (#56, reusa `Entidade.brasao`).

**Plano de contas do OPERADOR (`/app`) — COMPLETO (Specs 16-06):** **saldos** (#81: saldo inicial/débito/crédito/atual por natureza, roll-up do balancete, "saldo em <data>"), **razão** (#82: resumo mensal→dia→movimentos com saldo corrente), **fix do balancete por natureza** (#83: credora/retificadora SUBTRAI no rollup, saldo devedor COM SINAL — MCASP p.531, [[feedback-saldo-balancete-natureza]]), **lançamento contábil MANUAL** (#84: partida dobrada com picker datalist das ~6.7k analíticas, ∑D=∑C ao vivo, reflete em saldos/razão).

**Orçamento — ciclo COMPLETO:** **saldo orçamentário** com roll-up (#61, `/app/orcamento/saldo`), **créditos adicionais** (#62: suplementar/especial/extraordinário, reforço/anulação, aplicação imediata no `valorAutorizado`), **arrecadação da receita** (#71: `Arrecadacao` movimento imutável + `valorArrecadado` materializado, previsto×arrecadado por fonte/conta), **abertura de exercício / virada de ano** (#72: copia planos do ano novo p/ entidade existente), **fluxo de aprovação da LOA** (#116: status `RASCUNHO → ENVIADO_AO_LEGISLATIVO → APROVADO → PUBLICADO → EM_EXECUCAO` + trilha auditável `TransicaoStatusOrcamento`; abertura contábil exige `PUBLICADO`; `EM_EXECUCAO` só via abertura; trava de execução via helper `orcamentoPodeExecutar`).

**Integração contábil — RECEITA via Tabela de Eventos — ÉPICO COMPLETO (#90→#98):** arrecadação dispara lançamentos automáticos (partida dobrada) pelo `MotorEventosReceita`: **E100** orçamentário, **E200** DDR, **E300** patrimonial (caixa pela conta bancária da arrecadação, #91); conta-corrente = DIMENSÃO no `LancamentoItem` (não código). Trilha mão-dupla visível (#92). Receita NÃO-EFETIVA E400/E500 (#93). **Conciliação bancária** (#94/#96: extrato×arrecadações 1:1, parsers CSV/OFX/CNAB 240, import por arquivo via FileReader). Receita **tributária** (#95 lançamento E550/baixa E560; #97 dívida ativa E570 + multas E300; #98 baixa parcial controlada). Ver [[integracao-receita-eventos]], [[conciliacao-bancaria]].

**Integração contábil — DESPESA — ÉPICO COMPLETO (#109/#114):** **realização da despesa** Fase 1 (#109: razão imutável da ficha de empenho, ledger `MovimentoEmpenho`, estorno value-driven, classificação completa). **Motor da despesa** Fases 1→5 (#114): empenho→**E600**+E601, liquidação→**E700**/E701+**E702** patrimonial, pagamento→**E800**/E801+**E802** financeiro (caixa pela conta bancária); cc=dotação; estorno inverte D↔C. Ver [[despesa-eventos-contabeis-proposta]], [[spec-realizacao-despesa-2026-06-22]].

**Integração contábil — TABLE-DRIVEN + regras PCASP (#114):** as contas D/C de cada evento vêm da **Tabela de Eventos** (`EventoContabil`/`EventoLancamento`, editável no admin `/admin/eventos-contabeis`), não do código. Máscaras literais = códigos PCASP; **tokens** resolvem no disparo (`@VPD`/`@PASSIVO`/`@CAIXA`/`@DDR_CONTROLE`/`@ATIVO`/`@DIVIDA_ATIVA`…). **Gatilho** explícito (`EventoContabil.gatilho`) — motor filtra por gatilho, não pelo código. **Regras PCASP** (`pcasp-regras.ts`) no save: barra conta sintética/inexistente, exige D=C, bloqueia mistura de subsistemas P/O/C. Herança tabela+de/para no `ModeloContabil`, ligados por código.

**Abertura do exercício (PCASP) — COMPLETO (#110):** contabiliza a LOA: Parte A orçamentário (previsão D 6.2.1.1.0/C 5.2.1.1.1; fixação D 5.2.2.1.1.01/C 6.2.2.1.1) + Parte B transporte `SaldoInicialAno`=|saldo final ano−1| (classes 1/2). Idempotente + reversível; `OrigemLancamento+=ABERTURA`. Ver [[abertura-exercicio-pcasp]].

**Acumulado diário — TRÍADE COMPLETA:** **contábil** materializado (#112: `MovimentoDiarioConta` entidade×conta×dia + `SaldoDiarioService` + tela `/app/contas/:id/diario`), **receita** (#113: `ArrecadacaoDiariaService` lê o ledger `Arrecadacao`, arrecadado×previsto/dia), **despesa** (#115: `DespesaDiariaService` lê o ledger `MovimentoEmpenho`, 3 séries empenhado/liquidado/pago/dia vs fixado). Receita/despesa NÃO materializam (leem o ledger datado direto).

**Contas bancárias Febraban (#75):** `ContaBancaria` (banco/agência/conta, vínculo à fonte POR CÓDIGO + `contaContabilCodigo` folha 1.1.1.x) + CRUD `/app/contas-bancarias` + trava conta×fonte na emissão de OP.

**Gerador de Relatórios (`/app`) — COMPLETO:** templates de cabeçalho/rodapé (editor WYSIWYG + formatação rica/réguas/brasão #70), query SQL em **sandbox isolado por entidade** (role `genesis_report_ro` + views `rel_*` + GUC `app.entidade`), prévia HTML, pastas, **exportação em 8 formatos** (#53), **totais configuráveis por coluna** (#69) + painel de totais no design (#73), **picker de view/colunas** no editor (#68). Ver [[relatorios-gerador-plano]].

**Painel de Escopo (#57):** `/admin/escopo` — roadmap em HTML (KPIs + progresso + badges por área). Fonte da verdade = `src/services/escopo.ts` (tipado). **Atualizar no mesmo PR de cada feature nova.**

**Dados reais no dev:** LOA 2026 da **Prefeitura de Maringá** importada do Portal da Transparência (#74 versionou o script) — 403 previsões + 2.325 dotações (fixado 2,84bi exato). Caveats: fonte 9999 na despesa, receita bruta > despesa. Ver [[orcamento-maringa-importado]].

## O que falta (backlog — candidatos a "próxima funcionalidade")

> Os grandes épicos fecharam (receita, despesa, contábil table-driven, abertura PCASP, acumulado diário, aprovação da LOA). O backlog agora é de itens menores / a definir.

1. **Modelo Rondônia — fonte específica.** Os 3 planos do RO estão provisoriamente idênticos ao PARANÁ. **⏳ Aguarda o Marco padronizar a fonte RO e reenviar** → re-importar receita/despesa do RO.
2. ~~UX de acesso a entidades no /app~~ ✅ **FEITO** (#117 + #118): SOLICITAÇÃO **e** autoconcessão. Usuário sem acesso entra e solicita (`/app/solicitar-acesso` + `minhas-solicitacoes`); aprovação no admin do sistema (`/admin/acessos-entidade/solicitacoes`, #117) **e** no painel do admin da entidade (`/app/entidade/acessos`, #118 — aprova/rejeita + nível/revogação, escopado, anti-lockout). Modelo `SolicitacaoAcessoEntidade`. Bootstrap do 1º admin segue no admin do sistema.
3. ~~Contexto /app não refiltra `Entidade.ativo`~~ ✅ **FEITO** (`0a8405d`): seletor de contexto (`listarPorUsuario`), validação do POST (`usuarioPodeAcessar`), middleware por request e gate de login (`temAcesso`) passam a exigir `Entidade.ativo`; entidade desativada mid-sessão derruba o contexto.
4. **Consolidação mensal do município** (candidato levantado, não detalhado).
5. **Próxima grande frente a definir com o Marco.**

## Decisões técnicas importantes

- Prisma 7 exige `driverAdapters` em `previewFeatures` e `new PrismaClient({ adapter })`; com driver adapter, `datasource db` não precisa de `url` (generate roda sem DATABASE_URL)
- Runner de dev é `tsx` (sem watch — restart manual após mudança em .ts ou .ejs; view engine não cacheia EJS em dev)
- `exactOptionalPropertyTypes: true` no tsconfig; erros `TS6059` de `scripts/*.ts` fora do `rootDir` são pré-existentes e NÃO travam o CI
- ⚠️ **Engine de migração Prisma 7.7 quebra localmente** com `H.replace` (afeta `migrate diff`/`db execute`/`migrate resolve`) → aplicar `migration.sql` via `psql` + INSERT à mão em `_prisma_migrations` (checksum `sha256sum`); `generate`/`validate` funcionam ([[prisma-migrate-engine-bug-7.7]]). NÃO `migrate reset` ([[prisma-migrate-drift-genesis]])
- `prisma generate` após `migrate dev` não atualiza o client em node_modules sozinho neste setup ([[prisma-generate-apos-migrate]])
- Import em massa de plano-MODELO via script fura o `SincronizadorContas` → entidades defasam; remediar com `scripts/ressincronizar_entidades_modelo.ts` ([[contabil-import-massa-bypassa-sync]])
- Conta-corrente contábil = DIMENSÃO no `LancamentoItem`, não código concatenado (classe 6 e DDR são folhas)
- SortableJS com `forceFallback:true` (handle em `<button>`); usar variável `_ddCtrlAtivo` por keydown/keyup (ler `ctrlKey` no onEnd é inconsistente)
- JSON dentro de atributo de evento (onsubmit/onclick) SEMPRE com `<%=`, nunca `<%-` (em `<script>` é o contrário) ([[ejs-json-em-atributo-de-evento]])
- Forms sob `/app` precisam de URL absoluta `/app/...`; `inject` de teste sem prefixo não pega o bug ([[rodar-app-admin]]). curl POST sem corpo vira GET → usar `-X POST` ([[feedback-curl-post-sem-corpo-vira-get]])
- Testes mockam `email.js`/`sms.js` (nodemailer + Twilio) para não vazar para SMTP real
- Feedback ao admin via `HX-Trigger: {"mostrarInfo": {titulo, texto}}` — modal informativo em `main.ejs`
- **Guard de fragmentos** (`admin/index.ts`): GET não-HTMX com ≥2 segmentos vira fragmento → redirect p/ `/admin`. Página completa sob caminho profundo precisa entrar no Set `PAGINAS_COMPLETAS_PROFUNDAS` (exceção blanket: `funcionando/*`)
- **Coordenação entre sessões**: working tree compartilhada; antes de `git checkout -b` rodar `git branch --show-current`. PR empilhada cujo branch-base é deletado no merge é FECHADA pelo GitHub → rebasear no master e abrir PR nova ([[merge-stack-squash-x-ours]], [[reabrir-pr-para-redisparar-ci]], [[coordenacao-sessoes]])

**Why:** Stack escolhida para programador COBOL veterano — tipagem forte, schema declarativo.
**How to apply:** Continuar padrões service/route. Admin splitpane para hierarquias, modal para entidades simples. Confirmações destrutivas via `data-confirm-*`. Ao criar/editar service crítico, criar `X.test.ts` e manter 100% de cobertura. Atualizar `src/services/escopo.ts` no mesmo PR de cada feature.
