---
name: varredura-segredos-setup
description: "Higiene de segredos do Gênesis — como o bloqueio de leitura funciona (.claudeignore é INERTE), scanner, e a rotação de chaves ainda PENDENTE"
metadata: 
  node_type: memory
  type: project
  originSessionId: f25ba169-e1d0-44e9-85c1-53ef205313cf
---

# Varredura de segredos — setup e pendência (PR #253, 2026-07-14)

Varredura completa de vazamento de chaves. **Nenhum segredo real no histórico do git**
(confirmado com gitleaks sobre os 430 commits + `git log -S`). Os segredos reais só
existiam em arquivos **gitignored, nunca commitados**: `.env` e `.claude/settings.local.json`.

## Bloqueio de leitura de segredos pelo Claude Code
- ⚠️ **`.claudeignore` NÃO é lido pelo Claude Code** — existe no repo só como documentação. Não bloqueia nada.
- O bloqueio que o Claude Code **de fato aplica** é `permissions.deny` (regras `Read(...)`):
  - **Versionado:** `.claude/settings.json` (deny de `Read(.env)`, `**/*.pem|key|p12|pfx|jks`, `secrets/`).
    O `.gitignore` foi ajustado com `!.claude/settings.json` p/ ele viajar com o repo.
  - **Local:** `.claude/settings.local.json` (regras da máquina) segue gitignored (`.claude/*`).
- deny é união de todos os escopos e vence allow.

## Scanner
- `varredura-segredos.sh` na raiz (só reporta). Cuidado histórico: o regex de URL só pegava
  `postgres://` e deixava `postgresql://` passar — foi o ponto cego que escondeu a senha do banco.
- `.gitleaks.toml` na raiz (carrega sozinho). Allowlist **por valor** (não por linha, que é frágil):
  libera `token-dev-oxy` (GENESIS_API_TOKEN de dev) e `ci-e2e-secret-nao-usar-em-producao` (JWT do CI).
  Uso: `gitleaks git .` (histórico) e `gitleaks dir .` (working tree); gitleaks instalado em `~/.local/bin`.

## ✅ Rotação FEITA (2026-07-14)
Marco rotacionou `ANTHROPIC_API_KEY` e a senha do Postgres (`mandrade1965`) — os valores que
circularam em sessão do Claude estão queimados. A senha antiga do banco estava inline em 9 regras
do `settings.local.json` (removidas). Passos ficam em `checklist-rotacao-chaves.md` p/ próximas vezes.
Ver [[coordenacao-sessoes]].
