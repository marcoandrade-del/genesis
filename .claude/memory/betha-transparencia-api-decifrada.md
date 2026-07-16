---
name: betha-transparencia-api-decifrada
description: "Como acessar a API do Portal da Transparência Betha (transparencia.betha.cloud) de forma anônima — token OAuth anônimo, header app-context, catálogo de consultas — decifrado no cliente Criciúma/SC"
metadata: 
  node_type: memory
  type: reference
  originSessionId: fdf96195-b214-468c-9996-45157e13fb93
---

# API Betha Transparência Cloud — decifrada (2026-07-16, cliente Criciúma/SC)

Reverse-engineering do `transparencia.betha.cloud` (SPA Angular/Vue) para o CONVERSOR fabricante Betha ([[conversor-arquitetura-fabricante]]). O conector atual (`src/conversor/fabricantes/betha/dados-abertos.ts`) assumia **GET anônimo** em `{base}/api/consulta/{id}?formato=json` — **ISSO ESTÁ ERRADO**: a API exige token + header de portal + POST.

## Config do portal (de `window.transparenciaConfig` no index.html)
- `apiUrl` = `https://api.transparencia.betha.cloud/transparencia`
- `urlDadosAbertos` = `https://dados.transparencia.betha.cloud/transparencia/dados-abertos`
- OAuth (de `env.js`, ofuscado — decodificar rodando o env.js num stub `window`): host `https://plataforma-oauth.betha.cloud/auth/oauth2`; clientId `91a97459-f1d8-4b29-b5fa-2e51d1692623`; scope `transparencia.public`; redirect `https://transparencia.betha.cloud/auth-callback.html`.

## 1. Token ANÔNIMO (sem captcha!) — implicit flow
`GET {oauthHost}/authorize?response_type=token&client_id=91a97459-...&scope=transparencia.public&redirect_uri=https://transparencia.betha.cloud/auth-callback.html&access_mode=anonymous`
→ 302 com `Location: ...#access_token=<uuid>&token_type=bearer&expires_in=3515`. Pega o access_token do fragmento. Vale ~1h. `access_mode=anonymous` NÃO precisa de recaptcha.

## 2. Contexto do PORTAL = header `app-context`
A URL do município (`#/n4W91vnHptoBkiHKAxioOA==/dados-abertos`) traz o **hash do portal**. O contexto viaja no header:
`app-context: base64('{"portal":"<hash>"}')`. Ex. Criciúma: `eyJwb3J0YWwiOiJuNFc5MXZuSHB0b0JraUhLQXhpb09BPT0ifQ==`.
Sem esse header, a API responde 422 "código do portal não informado" ou 401.

## 3. Endpoints (com `Authorization: Bearer <token>` + `app-context`)
- `GET {apiUrl}/api/portal` → dados do município (id, nome, uf, codigoIbge, **portalEntidades[]** com `{id,database,entidade}`). Criciúma: **portal id 27, database 26, IBGE 4204608, 11 entidades** (codes: 189,185,181,188,1028,184,1027,178,186,191,29).
- `GET {apiUrl}/api/menu` → **catálogo de consultas**: árvore com nós `{id, titulo, tipo, exibeDadosAbertos}`. O `id` é o consultaId. Criciúma: **Receitas Orçamentárias=34858**, Receita Prevista x Realizada=34838, **Despesas Orçamentárias=34875**, Despesas por Classificação Orçamentária=174485, Execução Detalhada de Despesas=34845.
- `GET {apiUrl}/api/consulta/{id}/{filtros,tabular,detalhar,ordenacao}` → só SCHEMA/metadados (colunas), NÃO dados.
- `auth/portais` (só 20 em destaque, não pesquisável) — inútil p/ achar um município específico; use o hash do portal direto.

## 4. DADOS (linhas) — ✅ FECHADO (endpoint = busca-textual, NÃO o dados-abertos)
O dados-abertos `formato=json` é um beco (POST 500/406). O QUE FUNCIONA é o mesmo endpoint do grid do SPA:
**`POST {apiUrl}/api/busca-textual/{consultaId}?sortBy=null&sortDirection=null&offset=0&limit=5000&hiperlink=false`**
com `Authorization: Bearer` + `app-context` + `Content-Type: application/json` + corpo **`{}`** (sem filtro = TODOS os anos/entidades). ⚠️ dá **500 transitório** (ES) — RETRY 2-3× resolve.
Resposta ES: `{ totalHits, hits:[{ id, sourceAsMap:{...} }] }`. ⚠️ **offset máx = 10000 (janela ES)** → filtrar server-side, não paginar tudo. **FILTRO no corpo = facetas: `{"ano":["2026"]}`** (array de strings; capturado do botão "Filtrar (ENTER)" do SPA; outros campos idem `{"campo":["v1","v2"]}`). Buckets disponíveis: `GET /api/busca-textual/{id}/filtro/{campo}/MAX`. `POST .../{id}/totalizadores` (mesmo corpo de filtro) dá os totais oficiais — ⚠️ `valorOrcado*` SOMA vem INFLADO (linha por MÊS; deduplicar por natureza), mas `valorArrecadadoNoMes` SOMA = arrecadado real do ano.

### ✅ VALIDAÇÃO AO CENTAVO (receita 2026 Criciúma, 2026-07-16)
1069 linhas 2026; **arrecadado Σ`valorArrecadadoNoMes` = R$ 708.247.979,27 = totalizador oficial EXATO (Δ 0,00)**. Extração completa e correta. (Previsão: deduplicar `valorOrcadoAtualizado` por entidade×natureza no maior mês — o regex do id de 2026 difere do de anos antigos; ajuste mecânico.) ⚠️ **ES é FLAKY: 500 transitório frequente — retry 4-5× é obrigatório** em todo POST busca-textual.

### Colunas por consulta (Criciúma) — MISMATCH com o que o conversor precisa
- **34858 Receitas Orçamentárias** (26947): `rubricaNatureza, descricaoNatureza, valorOrcado, valorOrcadoAtualizado, valorArrecadadoAteMes, valorArrecadadoNoMes` — **SEM fonte, SEM órgão**. Serve p/ previsão+arrecadação por natureza (fonte=placeholder).
- **34875 Despesas Orçamentárias** (4994): `idNatureza, descricao, valorOrcado, valorEmpenhado/Liquidado/PagoAtualizado` — **SÓ natureza, SEM dimensões** (não serve p/ o QDD que o `lerDespesa` exige: órgão/unidade/função/subfunção/programa/ação — L.req falha-alto).
- **174485 Despesas por Classificação / 34845 Execução Detalhada** (171389): TÊM `descricaoOrgao/Unidade/Funcao/Subfuncao, mascaraElemento(natureza), descricaoRecurso(fonte), valorEmpenho/Liquidado/Pago` — mas é **nível EMPENHO (execução)**, não dotação/QDD inicial. (Execução, no modelo do conversor, vem do TCE-SC, não do fabricante.)
- **Lacuna:** Criciúma/Betha não expõe um QDD dimensional (dotação inicial por órgão/função/fonte) num único dataset — só natureza-level (34875) ou empenho-dimensional (174485).
- **DESPESA CONSTRUÍDA via 174485 (genesis PR #264, decisão do Marco):** o `lerDespesa` usa a 174485 como EXECUÇÃO Betha (empenho — em SC o Betha cobre execução, não só o TCE): agrega empenhos por órgão×unidade×função×subfunção×natureza×fonte → empenhado/liquidado/pago (não dotação). Dimensões vêm "código - nome" (helper `codigoNome`); natureza da `mascaraElemento`; fonte do `descricaoRecurso`. **174485 NÃO traz programa/ação nas linhas → placeholder "0000"** (relaxar acordado). Migrou receita+despesa p/ `api.ts`; deletou `dados-abertos.ts`. Testes mock + tsc + suíte 3698. **⚠️ VALIDAÇÃO AO VIVO PENDENTE (ES fora na construção):** (a) totais empenhado/liquidado/pago ao centavo; (b) formato real das descrições; (c) **janela ES 10k** — a 174485 tem 171k linhas (todos anos); se 2026 > 10k, `lerConsulta` lança e precisa de CHUNKING (por entidade/mês). NÃO mergear o #264 antes de validar.

## 5. Domínio próprio do município (padrão nome.uf.gov.br)
Criciúma: transparência real em **`transparencia.criciuma.sc.gov.br`** (subdomínio municipal, white-label). Vale checar por município — pode ter via INDA própria/mais aberta. `www.criciuma.sc.gov.br` linka pra lá.

## ✅ CONECTOR DA RECEITA REESCRITO (genesis PR #263, 2026-07-16)
`src/conversor/fabricantes/betha/api.ts` (cliente real: `tokenAnonimo`+`appContext`+`lerConsulta` com retry/paginação/faceta+`entidadeDoId`) + `lerReceita` reescrita (agrega por **entidade×natureza**: arrecadado=Σ`valorArrecadadoNoMes`, previsão=**MAIOR** orçado do ano — o orçado vem 0 em meses não-carregados, então max, não max-mês) + `naturezaReceitaBetha` no codigo.ts (dropa o indicador da rubrica). **RECEITA FECHADA AO CENTAVO (via conector real, Criciúma 2026): previsão R$ 2.127.975.634,05 · arrecadado R$ 708.247.979,27 = totalizadores oficiais, Δ 0.** Chave: o portal totaliza SOMANDO os meses (previsão=Σ`valorOrcadoAtualizado`, arrecadado=Σ`valorArrecadadoNoMes`) — os totalizadores de "Receitas Orçamentárias" (34858) E de "Receita Prevista x Realizada" (34838) confirmam o orçado 2.127.975.634,05. Config em `ent.params`: `portalHash`, `consultaReceita`, opc. `entidadeBetha`. ⚠️ **Achado a investigar (não bloqueia):** a 34838 reporta arrecadado 757.808.606,66 (≠ 708,2mi da 34858, Δ ~49,56mi) — consultas medem arrecadação com escopo diferente; o conector usa a 34858 (natureza-level) coerente com seu próprio totalizador. **Despesa INTOCADA** (client legado dados-abertos.ts; QDD dimensional = questão aberta). Suíte 3698. Worktree `genesis-wt-betha`.

## GABARITO SICONFI da despesa de Criciúma + fabricante SICONFI universal (2026-07-16)
A sessão cauda-fontes apontou o **SICONFI como ground-truth universal** (mesma API da MSC, `apidatalake.tesouro.gov.br/ords/siconfi/tt/msc_orcamentaria`, `id_tv=ending_balance` NÃO `id_tc`, `co_tipo_matriz=MSCC`, `classe_conta=6`, `id_ente=4204608`). **PROVADO p/ Criciúma** (paginado, ESTÁVEL — não cai como o ES do Betha). A linha da MSC orçamentária traz `funcao, subfuncao, natureza_despesa, fonte_recursos, poder_orgao, educacao_saude(flag MDE/ASPS), valor, natureza_conta`.
**GABARITO despesa Criciúma 2026 (Jan–Mai, consolidado 3 poderes):** empenhado (6.2.2.1.3) **R$ 1.032.513.633,28** · liquidado (.03+.04) 510.432.805,03 · pago (6.2.2.1.3.04) 476.542.587,41. Por função (empenhado): 10 Saúde 256,0mi · 12 Educação 250,1mi · 15 Urbanismo 162,5 · 04 Admin 155,3.
**DECISÃO TOMADA (Marco escolheu "começa o SICONFI", 2026-07-16): FonteExecucao SICONFI CONSTRUÍDA + PROVADA — PR #265.** `src/conversor/tce/siconfi.ts` (`FonteExecucao` `siconfi` em `tce/registry.ts`, ao lado do PIT): lê a MSC classe 6 (`ending_balance`) por IBGE, decompõe `6.2.2.1.3.0X` → empenhado (todo 6.2.2.1.3)/liquidado(.03+.04)/pago(.04) por função×subfunção×natureza(elemento)×fonte×poder_orgao. `agregarExecucao` pura+testável; auto-descobre o último mês (12→1); `matchSiconfi`=poder_orgao isola a entidade; `EntidadeConfig.matchSiconfi` aditivo. **PROVA: Criciúma 2026 mês5 fecha o gabarito AO CENTAVO (Δ0) nos três (517 dimensões).** Mock 6/6, conversor 34/34. LIMITE (por design): sem UO/programa/ação (placeholder) → baseline; o QDD dimensional (Betha 174485) vira ENRIQUECIMENTO.

**✅ TRILOGIA SICONFI COMPLETA + CRICIÚMA IMPORTADA NO DEV (2026-07-16):** #265 execução (empenhado/liq/pago, 6.2.2.1.3) + **#266 receita** (`fabricantes/siconfi/conector.ts::lerReceita`: previsão inicial 5.2.1.1.1 + realizada 6.2.1.2 por natureza×fonte; `naturezaReceita` movido p/ `nucleo/pcasp.ts`) + **#267 dotação/standalone** (`lerDespesa`=autorizado da fixação `5.2.2.1.1+5.2.2.1.2−5.2.2.1.9`; `naturezaDespesaMsc(nd,nivel)`; `agregarExecucao` ganhou `nivel` — **modalidade** casa empenho↔dotação; `municipios/criciuma-sc.ts` fabricante+tce='siconfi', 3 entidades por poder_orgao). **APLICADO no dev (OK do Marco, runner `scripts/importar_criciuma_siconfi.ts`):** SC.modeloContabilId setado p/ `75bf5364` (modelo compartilhado MS/Naviraí — ver [[padroes-do-estado-canonicos]]); as **7 métricas fecham o gabarito MSC AO CENTAVO (Δ0)**: previsto 2.323.592.700,00 · arrec 665.362.113,62 · autorizado 2.305.697.163,24 · empenhado 1.032.513.633,28 · liq 510.432.805,03 · pago 476.542.587,41; 176 previsões, 437 dotações, 0 SEM conta. **Dev tem 2 municípios: Maringá/PR + Criciúma/SC. Espinha SICONFI = importar QUALQUER IBGE só setando o modelo do estado.** (Depois usei essa MSC como ground-truth p/ validar o #264 — ver o veredito de encerramento abaixo.)

## ❌ #264 ENCERRADO (2026-07-16, validação ao vivo com o ES de volta) — SICONFI supera
O ES do Betha voltou e permitiu validar. **Veredito: o 174485 NÃO serve como execução de 2026** e foi **fechado sem merge** (PR #264 closed; worktree removido; branch remota preservada p/ referência):
- **Multi-ano:** `POST /api/busca-textual/174485/totalizadores {}` → Σ empenho **12.745.528.580,79** · liquidado 9.338.370.136,25 · pago 8.871.724.211,27. É ≈12× o 2026 (SICONFI 1,03bi); 171.389 empenhos ≈ 5–6 exercícios. **`{ano:['2026']}` NÃO filtra** (mesmo total) — não há campo `exercicio`/`ano` no registro; só `dataEmpenho` (facet vai até 13/07/2026, mas contaminado por datas de 2025).
- **Sem dimensões-código:** amostra real → `descricaoOrgao`="SEC. M. DE INFRAEST...", `descricaoFuncao`="Urbanismo" (NOME puro, sem "código -") e **nenhum campo de programa/ação**. O `codigoNome` sairia vazio; a dimensão que era o motivo do #264 não existe.
- **Chunking:** 171k > janela ES 10k, sem faceta limpa p/ particionar.
- **SICONFI já entrega** a execução de Criciúma/2026 ao centavo (empenhado 1.032.513.633,28 · liq 510.432.805,03 · pago 476.542.587,41), gravado no dev Δ0 → 174485 é redundante E pior. **Receita Betha #263 (mergeada) fica.** Salvar o #264 exigiria achar o filtro de exercício + chunking + dimensões-por-nome, p/ entregar menos que o SICONFI. NÃO vale.
- **Padrão útil aprendido:** `POST /api/busca-textual/{id}/totalizadores` (corpo = filtro) dá os totais oficiais de qualquer consulta SEM paginar — bom p/ validação rápida.

## Recap do que ESTÁ automatizado (sem ação do usuário) p/ QUALQUER município Betha
1. token anônimo (§1) → 2. resolver portal pelo hash da URL via header app-context (§2) → 3. `/api/portal` (entidades) + `/api/menu` (achar consultas por título) (§3) → 4. `/api/busca-textual/{id}` pagina os dados (§4). Config por município = só a URL/hash do portal; o resto é descoberto.

## Como investigar (sandbox tem internet; Playwright+chromium instalados)
Dirigir o SPA headless e capturar `page.on('request')` é o caminho definitivo (o bundle `app.js` é grande mas grep-ável; `env.js` decodifica rodando em stub). O município **Criciúma foi CONFIRMADO** (Prefeitura Municipal de Criciúma) dirigindo o SPA.
