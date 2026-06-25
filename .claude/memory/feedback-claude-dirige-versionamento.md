---
name: feedback-claude-dirige-versionamento
description: Marco delega o controle de versionamento/repositório ao Claude — conduzir branch→PR→CI→merge→limpeza e explicar em linguagem simples
metadata:
  node_type: memory
  type: feedback
  originSessionId: 431b9bde-a8b1-4b3b-a10b-481a9bc6be88
---

# Marco delega o controle do repositório ao Claude

Marco disse (2026-06-25) que **não tem experiência com versionamento de repositório** e prefere que o Claude **conduza e sugira** o controle do repo, em linguagem simples (sem jargão).

**Why:** ele quer focar no produto, não no git; decisões de branch/PR/merge devem ser do Claude, com explicação clara.

**How to apply:**
- **Conduzir o ciclo inteiro por tarefa:** branch por feature/fix → abrir PR (a CI `test`+`e2e` é a rede de segurança) → **quando a CI fica verde, squash-merge na master + apagar a branch + sincronizar a master local**. Não esperar o Marco "clicar mergear".
- **Manter o remoto limpo:** `git fetch --prune`; apagar branches já mergeadas.
- **Código → sempre PR+CI.** Memória/docs (`.claude/memory`, roadmap) → commit direto na master (não precisa de CI).
- **Confirmar só o arriscado/irreversível:** apagar branch **NÃO** mergeada (pode ter trabalho único), apagar dados, push para algo externo/compartilhado. Para o resto, agir e relatar.
- Explicar o que foi feito em 1-2 linhas simples a cada merge. Ver [[coordenacao-sessoes]] e [[reabrir-pr-para-redisparar-ci]].
