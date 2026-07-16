---
name: oxy-genesis-cada-um-comita
description: Protocolo de commit na colaboração multi-sessão OXY↔Gênesis — cada sessão commita o que fizer, no repo onde fez
metadata:
  node_type: memory
  type: feedback
---

Na ponte OXY × Gênesis (contratos de dados), **cada sessão commita o que ela mesma fizer, no repo onde fez** — combinado explícito entre a sessão do OXY Dashboards e esta (2026-07-15).

**Why:** são repos git separados (`genesis`, `oxy-repo` = backend oxy-bi-jpa + docs, `oxy-dashboards` = front). A comunicação entre as sessões é por documento de contrato (`.docx` trocado via Marco + `oxy-repo/INTEGRACAO-GENESIS.md`). Sem dono único do commit, o trabalho se perde ou colide.

**How to apply:** se EU construo o lado Gênesis (endpoint `/api/memoriais/*`), commito+PR no repo `genesis`. Se EU construo o lado oxy-bi-jpa (conector Spring, controller, PR-C), commito+PR no `oxy-repo`. O lado do front (`oxy-dashboards`, trocar o stub) é da sessão OXY, a menos que o Marco peça. Não deixar mudança minha não-commitada esperando "a outra sessão" — se fiz, eu commito. Ver [[oxy-dashboards-integracao]].
