---
name: reabrir-pr-para-redisparar-ci
description: "Como re-disparar o CI de um PR cujo head ficou sem run, sem tocar na branch — fechar e reabrir o PR"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7542ce95-c63e-418e-b797-cdff6fa00d54
---

O workflow de CI do Gênesis é `.github/workflows/ci.yml`, que dispara só em `push: branches:[master]` e `pull_request` — **sem `workflow_dispatch`**. Logo `gh workflow run` não funciona.

Às vezes o head atual de um PR fica **sem run de CI** (ex.: após um `git rebase`/force-push que, por algum motivo, não registrou run no SHA novo — `gh pr checks N` diz *"no checks reported"* e `gh run list --branch X` só mostra SHAs antigos).

**Para re-disparar o CI no head atual SEM alterar a branch** (sem commit/rebase/empty-commit):
```
gh pr close N && gh pr reopen N
```
O evento `pull_request: reopened` está nos tipos default do trigger `pull_request` (opened, synchronize, reopened), então o workflow roda no SHA atual. Não muda commit nenhum; é ação de PR (papel da coord, OK mesmo em PR de outra sessão). Depois: `gh pr checks N --watch`.

`gh run rerun <id>` NÃO serve aqui: re-roda o run antigo no SHA antigo, não no head atual.

Usado para fechar o #43 (R2 Relatórios). Relacionado: [[coordenacao-sessoes]], [[merge-stack-squash-x-ours]].
