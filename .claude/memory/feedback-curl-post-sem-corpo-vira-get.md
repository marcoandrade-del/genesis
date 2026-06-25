---
name: feedback-curl-post-sem-corpo-vira-get
description: "Ao smoke-testar rotas POST do Gênesis com curl, sem -d/-X o curl manda GET e a rota POST-only dá 404 (view \"não encontrado\", não erro de negócio)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 855c1438-0f58-4705-b163-d98053a312e2
---

Rotas de ação no `/app` (ex.: `/relatorios/pastas/:id/excluir`) são **POST-only**. Ao testar com `curl` sem corpo, o curl faz **GET** por padrão → não casa a rota → 404 renderizando a view de "Página não encontrada" do app (`appNotFoundHandler`), que parece erro mas é route unmatched.

**Why:** perdi tempo investigando "server stale" achando que a rota não estava registrada; era só o método HTTP errado no meu teste. O create funcionou porque `--data-urlencode` força POST; o excluir (sem corpo) caiu em GET.

**How to apply:** para rotas de ação sem body, usar `curl -X POST`. Distinguir 404-de-rota (view genérica ~14KB, title "não encontrado") de 404-de-negócio (renderHub com banner de erro, ~22KB). Ver fluxo de auth/contexto do app em [[rodar-app-admin]].
