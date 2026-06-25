---
name: spec-revisao-2026-06-01
description: "Revisão 2026-06-01: 7 gaps auditados. Pacote permissão+login+exercício COMPLETO (PR-A/B/C/D/D2 = #32/33/34/39/41). Compras #35/36/38 abertos (outra sessão). Pendentes: dashboard escopo (#1), sync modelo→entidades (#2), atributos PCASP (#4), execução orçamentária (#5 — vai casar com Compras)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7454545d-96a8-4693-8863-77f7295de259
---

Revisão de regras feita 2026-06-01 contra `/home/marco/Downloads/Regras 29_05_2026.txt`. Sete gaps detectados; user priorizou e definiu três decisões:

**Próximo pacote**: permissão por entidade + login de usuário + seletor de exercício (itens 3+6+7 da spec).
**Why:** destrava uso real multi-municipal/multi-ano e é base para o módulo de Compras (Lei 14.133). Sem isso, não há como um operador escolher contexto.
**How to apply:** próximos PRs sequenciais sob este tema; ver [[contabil-tres-planos-de-contas]] para o roadmap antigo.

**Sincronização modelo→entidades (item 2)**: **automática no save da conta-modelo**.
**Why:** transparência > controle, conforme decisão do user. Adicionou conta no modelo do estado → propaga imediatamente para todas entidades do estado naquele ano, mas só `origem=MODELO` (desdobramentos da entidade ficam intactos).
**How to apply:** quando implementar, criar service `SincronizadorContas` chamado pelos services do plano-modelo (contas-receita/despesa/contábil); roda em mesma transação ou em job pós-commit.

**Módulo de Compras Públicas (Lei 14.133/2021 + 4.320/1964)**: **integrado com execução contábil desde o início**.
**Why:** Compras gera o empenho que é a execução orçamentária; separar duplica conceito. User quer fluxo único.
**How to apply:** quando chegarmos no módulo, planejar empenho como entidade compartilhada (filho de DotacaoDespesa + filho de NotaEmpenho que vem de Compras).

## Status dos gaps (atualizado 2026-06-02)

| # | Item | Status | Notas |
|---|---|---|---|
| 1 | Dashboard HTML de escopo | ✅ feito | PR #57 — `/admin/escopo`; roadmap versionado em `src/services/escopo.ts` (atualizar a cada feature) |
| 2 | Sync modelo→entidades | ❌ pendente, decisão = automático | contas têm `origem` + `modeloContaId` (FK fraca), falta o sincronizador |
| 3 | Multi-exercício na sessão | ✅ feito | cookie `genesis_exercicio` + `req.contexto.{entidadeId,ano}` injetado pelo middleware (PR-C #34). Áreas /app que consomem o contexto: `/app/orcamento` (PR-D #39), `/app/lancamentos` + `/app/contas` (PR-D2 #41). Padrão: toda área /app lê `req.contexto`, sem query string |
| 4 | Atributos PCASP no plano | ✅ feito | PR #60 — enums NaturezaInformacao/NaturezaSaldo/SuperavitFinanceiro + funcao em Conta (só plano-modelo); importador+backfill (dados TCE-PR); coluna na árvore contábil |
| 5 | Movimentação orçamentária | ⚠️ planejamento ok, execução zero | empenho/liquidação/pagamento + créditos adicionais. Vai casar com o módulo de Compras |
| 6 | Permissão por município/entidade | ✅ feito | PR-A #32 — `AcessoEntidade` (usuário × entidade × nível LEITURA/ESCRITA/ADMIN) + `AcessosEntidadeService.usuarioPodeAcessar`. PR-B #33 trouxe a UI admin |
| 7 | Login de usuário separado do admin | ✅ feito | PR-C #34 — `/app/login`, `/app/contexto`, `/app` dashboard. Cookie próprio `genesis_user_token`; cookie `genesis_exercicio` carrega `entidadeId:ano`. Middlewares `appAuthMiddleware` + `appContextoMiddleware` em `src/app/index.ts` |
| — | Compras públicas (módulo novo) | 🟡 em outra sessão, **3 PRs abertos** | #35 (planejamento), #36 (seleção), #38 (execução). Aguardando revisão/merge. NÃO interferir |
| — | Drag-and-drop de menus | ✅ fix #37 | bug corrigido: container colapsado/vazio agora ganha drop-zone + hover-expand 600ms + bloqueio cross-module |

## Próximos passos sugeridos (não compromissos)

- **PRs abertos a revisar/mergear**: #35 / #36 / #38 (Compras 1/2/3 — stack encadeado, sessão outra). PR-D e PR-D2 já mergeados (item 3 fechado).
- **Item 1**: dashboard HTML de escopo no admin (rápido — render do roadmap).
- **Itens 2 + 4**: sync modelo→entidades + atributos PCASP (combinar porque ambos mexem no plano).
- **Item 5**: execução orçamentária — provavelmente depois que o módulo de Compras (outra sessão) estabilizar, para não conflitar.

Conecta com [[contabil-tres-planos-de-contas]] (roadmap geral) e [[project_estado]] (estado do projeto).
