---
name: oxy-dashboards-integracao
description: "Projeto Oxy Dashboards (BI+IA sobre dados públicos, do Marco) e a estratégia de integração com o Gênesis — Gênesis = sistema de registro; Oxy = camada de BI/IA/LRF. Specs LRF em 'Specs LRF e Memoriais de Cálculo.txt'."
metadata:
  node_type: memory
  type: project
  originSessionId: 54bff2d1-e062-496b-aaad-a2da27d1b21f
---

# Oxy Dashboards × Gênesis — separação de responsabilidades

Marco está construindo um **segundo projeto, Oxy Dashboards**: BI sobre dados públicos com **IA rápida + IA avançada** (insights automáticos, alertas, **persona conversacional** que "mastiga" a informação) + um **buscador de inovações** (mudanças legais/normativas) que avisa o usuário, ele autoriza a atualização, guarda histórico. Vibe: https://claude.ai/share/a585c76a-2d00-46d4-b0c9-51fda3702884 (link de share — não navegável por mim).

## Specs LRF (arquivo `Specs LRF e Memoriais de Cálculo.txt`, raiz)
Memoriais de cálculo da LRF são definidos por lei (STN / Min. Planejamento), mas **cada TCE faz o seu memorial** para fiscalizar, e há **mudanças/inovações frequentes**. Memoriais (LRF, balancete, balanços) viram ferramenta de gestão quando dentro de um BI com IA.

## Recomendação de arquitetura (minha, endossada como o desenho correto)
- **Gênesis = sistema de REGISTRO** (transacional/ERP municipal): orçamento, execução (empenho→liquidação→pagamento), contabilidade, arrecadação. É a **fonte da verdade**.
- **Oxy = camada de BI/IA/LRF**: consome os dados do Gênesis e roda os **memoriais de cálculo** (RREO/RGF, limites **MDE 25% / Saúde 15% / Fundeb / Pessoal**) + insights/alertas/persona. **NÃO trazer BI/IA para dentro do Gênesis.**
- Os memoriais são **cálculos SOBRE** os dados do Gênesis → pertencem ao Oxy. O dever do Gênesis é entregar os dados na **granularidade certa** (função/subfunção/programa/ação/natureza+**sub-elemento**/fonte) — que é justamente o que a realização da despesa (#109) construiu. **A realização da despesa é a fundação dos memoriais.**

## Como os dois "compartilham" (não é cópia de código — é CONTRATO de dados)
1. **MSC (Matriz de Saldos Contábeis) → Siconfi** = o formato **nacional padrão** de intercâmbio. Gênesis produz a MSC; Oxy consome. Caminho de integração mais natural.
2. **Views `rel_*`** (sandbox read-only que o Gênesis já tem p/ relatórios) + um data API read-only para consultas mais ricas.
3. **Memoriais (fórmulas, por TCE)** = artefato/spec **compartilhado** que os dois referenciam. O **buscador de inovações** é capacidade transversal (pode ser serviço compartilhado), mas o consumo (avisar/autorizar/histórico) é BI → Oxy.

## Implicação p/ o roadmap do Gênesis
O que mais habilita LRF/Oxy é **fechar a ponte execução→contabilidade** (o Motor de Eventos da Despesa, PR #114, em andamento) **+ a MSC**. Isso completa o lado "sistema de registro" e dá ao Oxy o dado completo e correto. Ver [[spec-realizacao-despesa-2026-06-22]], [[integracao-receita-eventos]].

## Contrato concreto de memoriais (implementado 2026-06-27) — calculado no Gênesis, exibido no Oxy
Decisão do Marco: **tudo calculado no Gênesis**, o Oxy **só exibe** (inputs + demonstrativo + total); cálculo ÚNICO → consistente nos dois lados; **com versionamento p/ não dar erro de versão**.
- **Gênesis (produtor):** `src/api/memoriais.ts` (PR #141) — data API read-only `/api/memoriais/{rcl,rcl-consolidada,contrato}`, **token de serviço** `GENESIS_API_TOKEN` (503 se ausente, 401 se errado). `MemorialRclService` reusa o `RclService`. Envelope `{contrato:{nome:'memoriais-lrf',versao,recurso}, dados}`. Versão atual **1.0.0**.
- **Oxy (consumidor):** `oxy-ia-backend/src/genesis.ts` — conector com `CONTRATO_MEMORIAIS_MAJOR` (=1). Compara o MAJOR do envelope; **MAJOR diferente ⇒ 409 "conector desatualizado"** (NÃO renderiza dado errado). `checarContratoMemoriais()` roda no boot (index.ts) e loga compatibilidade. Rotas `/api/memoriais/{rcl,rcl-consolidada}` (sessao) repassam o `dados` pronto.
- **Regra de versão (os dois honram SemVer):** mudou cálculo/forma no Gênesis ⇒ bump da versão. Quebra (campo removido/renomeado/semântica) = **MAJOR** → Oxy detecta e pede atualização. Adição compatível = MINOR (Oxy segue). 
- ⚠️ **oxy-ia-backend NÃO é repo git** (editei direto, typecheck limpo, e2e verificado). Falta: o **front (oxy-dashboards)** chamar `/api/memoriais/*` pra exibir; e por chaves no `.env` dos dois lados (`GENESIS_API_TOKEN` igual).
- **ANTHROPIC_API_KEY real no ar (2026-07-06):** Marco criou a chave; está no `.env` do Gênesis (import-IA de memoriais OK, 200 em 4s) e do oxy-ia-backend (Análise Profunda REAL, `mock:false`, ~R$0,13/análise). Armadilhas corrigidas: o oxy **não carregava .env** (sem dotenv) → scripts agora usam `tsx --env-file=.env`; e a chave tinha vazado pro `.env.example` → sanitizado. Login demo do oxy: `marco`/`demo` (:4000).
- Verificado e2e (2026-06-27): compatível→RCL 2.604.051.913; MAJOR divergente→409; token errado→502.

## Topologia REAL dos repos Oxy (apurada 2026-06-27) + fatia 1 da integração
**Canônico = `oxy-repo`** (git, branch `main`, origin marcoandrade-del/oxy-repo): monorepo com `backend/oxy-bi-jpa` (**Spring Boot 3, Java 17, :8080**, Flyway, OpenAPI-first, testes JUnit/AssertJ/Mockito) + `frontend/` (mockups HTML) + specs/docs. O pacote **`fiscal/`** já tinha o **Guardião LRF**: porta `MotorApuracaoFiscal` (resolvida via `ObjectProvider`), `ApuracaoIndicador` (com `MemorialCalculo` + `RegraVersao`), `SampleMotorApuracaoFiscal` (@Profile dev).
- **`oxy-dashboards`** (git separado, React/Vite) = front; fala com :8080 (= oxy-bi-jpa).
- **`oxy-ia-backend`** (Express/Node :4000, **não-git**) = **protótipo DEPRECADO**; o front não usa. Reverti as edições que fiz lá por engano.
- **Build Java:** `export JAVA_HOME=$(ls -d ~/.sdkman/candidates/java/current); export PATH="$JAVA_HOME/bin:~/.sdkman/candidates/maven/current/bin:$PATH"`; `mvn -o test` (offline, deps em cache). Não há `mvn` no PATH por padrão.

**Fatia 1 (PR #5 oxy-repo, mergeada):** `GenesisMotorApuracaoFiscal` (fiscal/) implementa a porta consumindo `/api/memoriais/rcl` do Gênesis (token), mapeia a RCL pronta → `ApuracaoIndicador` + `MemorialCalculo` + `RegraVersao`. **Segurança de versão**: confere MAJOR do `contrato.versao`; incompatível ⇒ recusa. `@Primary` + `@ConditionalOnProperty(genesis.api.token)` (liga com env `GENESIS_API_TOKEN`; senão Sample no dev). Config em application.yml (genesis.api.url/contrato-major, genesis.entidade-id). 3 testes verdes.
- **Rodar a integração real:** subir o Gênesis com `GENESIS_API_TOKEN`; subir o oxy-bi-jpa com `GENESIS_API_TOKEN` (mesmo valor) + `GENESIS_ENTIDADE_ID` (UUID da entidade) → Guardião mostra a RCL calculada no Gênesis.
- **Próximo:** indicadores Pessoal/MDE 25%/Saúde 15%/Fundeb exigem **novos memoriais no lado Gênesis** (hoje só RCL); depois o front (oxy-dashboards/mockup) exibir. A consistência é garantida porque o cálculo é único (Gênesis).

## Loop Guardião COMPLETO (2026-06-28) — Gênesis calcula, dashboard exibe
Fatia 2 do Guardião, ponta a ponta nos 3 repos:
- **Gênesis** (#142): `MemorialGuardiaoService` + `GET /api/memoriais/guardiao` → RCL + **Despesa com Pessoal** (% RCL, naturezas 3.1, base dotação; nível/limites/memorial). Contrato **1.1.0** (MINOR aditivo).
- **oxy-bi-jpa** (oxy-repo #7): `GenesisMotorApuracaoFiscal` consome `/guardiao` (mapeador puro) + `GuardiaoController` `GET /clientes/{id}/guardiao`. Erros versionados: `ContratoIncompativelException`→409, `MemorialIndisponivelException`→502.
- **oxy-dashboards** (#18 + fix #19): `FonteDados.guardiao()` (backend consome o controller com handshake de versão; demo usa `apurarGuardiao`); painel na tela **Integração**. Handshake de versão do contrato do PAINEL (oxy-painel) é separado do contrato MEMORIAIS-LRF (Gênesis↔oxy-bi-jpa) — dois handshakes, ambos honrados.
- **E2E validado:** oxy-bi-jpa→Gênesis (GENESIS_API_TOKEN+GENESIS_ENTIDADE_ID) → Maringá 2026: RCL R$ 2.604 Mi + Pessoal R$ 1.148 Mi (44,1% RCL, limite 54%, ok). Mismatch de MAJOR → 409 (não exibe dado errado).
- **PRÓXIMO:** indicadores Dívida/MDE/Saúde/Restos exigem dados/memoriais novos no Gênesis (hoje só RCL+Pessoal). PainelGuardiao (tela rica com série/projeção) ainda usa demo; migrar pro fonte.guardiao quando quiser a série real.

## Catálogo de ENTIDADES — cada entidade é uma unidade de BI (2026-07-15, PR #260)
A data-API cresceu p/ contratos PRÓPRIOS além do `memoriais-lrf` (hoje **1.16.0**): `valores-mensais 1.0.0`, `saldo-bancario 1.0.0`, `municipios 1.0.0` (#227, catálogo município→prefeitura), `acessos-usuario 1.0.0` (#242, multitenancy por e-mail). **Modelo do OXY evoluiu: cada ENTIDADE (não o município) é uma unidade de BI** — a tela `oxy-dashboards/src/screens/ImportarEntidades.tsx` (#80) deixa o usuário importar prefeitura/câmara/adm.indireta para o seu catálogo (`EntidadeDisponivel {id,nome,tipo,municipioId,municipioNome,uf,anosComOrcamento}`). O `backend.entidades()` fakeava (1 prefeitura/município) esperando o **PR-C**.
- **Gênesis entregou o PR-C: `GET /api/memoriais/entidades`** (contrato próprio **`entidades 1.0.0`**, `EntidadesCatalogoService`) — toda entidade `ativo=true` com plano copiado, TODOS os tipos, `{id,nome,tipo,municipio{id,nome,uf},anosComOrcamento}`, ordenada por município→tipo→nome. Aditivo/read-only, espelha o `/municipios`. PR **#260** (CI verde, suíte 3683). Validado ao vivo: 14 entidades reais no dev.
- **oxy-bi-jpa (PR-C) FEITO — oxy-repo PR #56 (CI verde, 175 testes):** conector `GenesisFonteEntidades` (achata `municipio.*`→plano) + `EntidadesController` `GET /entidades` (público, sem tenant) devolvendo `EntidadeDisponivel {id,nome,tipo,municipioId,municipioNome,uf,anosComOrcamento}` — o `backend.entidades()` do front vira passthrough. openapi path/schema + contrato OXY **1.7.0→1.8.0** (aditivo; MAJOR segue 1). `cnpj`/`ativo` do Gênesis são descartados no conector. Amostra byte-exata: `oxy-repo/docs/integracao/entidades.sample.json`.
- **Decisões confirmadas (docs OXY↔Gênesis):** achatamento no oxy-bi-jpa (Gênesis mantém `municipio` aninhado); **acesso-por-entidade DEFERIDO** (shape futuro `GET /api/memoriais/acessos-entidades?email=`→`{email,entidades:[{id,municipioId,nivel}]}`, claims viram `entidades_permitidas`).
- **Falta:** (1) sessão OXY troca o stub do `backend.entidades()` por `GET /entidades` do :8080 (PR do dashboard) + e2e; (2) **follow-up:** painéis `/clientes/{clienteId}/...` ainda resolvem clienteId→PREFEITURA via `EntidadeResolver` — ver painel de entidade NÃO-prefeitura exige `clienteId=entidadeId` (casa com o acesso-por-entidade). Este marco entregou só a **descoberta/importação**. Protocolo de commit: [[oxy-genesis-cada-um-comita]].
- **Runbook (subir a cadeia p/ consumir ao vivo):** Gênesis :3000 (`GENESIS_API_TOKEN`) → oxy-bi-jpa :8080 (MESMO token) → front :5173. `GENESIS_ENTIDADE_ID` foi REMOVIDO (a entidade vem do catálogo). Ver `oxy-repo/INTEGRACAO-GENESIS.md`.
