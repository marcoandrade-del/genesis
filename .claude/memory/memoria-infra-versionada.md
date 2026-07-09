---
name: memoria-infra-versionada
description: Como a memória do Gênesis é armazenada, sincronizada e versionada — paths do harness, symlink da chave antiga, sync_memory.py e git
metadata:
  node_type: memory
  type: project
  originSessionId: 431b9bde-a8b1-4b3b-a10b-481a9bc6be88
---

# Infra de memória do Gênesis (path/sync/git)

A pasta do projeto foi movida para `~/claude/Projetos/genesis`; `~/claude/genesis` é um **symlink** para ela. O Claude Code indexa a memória pela cwd, então a chave mudou de `-home-marco-claude-genesis` → `-home-marco-claude-Projetos-genesis`. Migrado em 2026-06-25 (commit `fde935b` em master).

**Três locais, uma fonte de verdade:**
- `…/projects/-home-marco-claude-Projetos-genesis/memory/` — **canônico** do harness; auto-carrega como `MEMORY.md`. **Escreva memória aqui.**
- `~/claude/Projetos/genesis/.claude/memory/` — cópia **in-repo, versionada no git** (sobrevive a clone/máquina nova). `.claude/` está no `.gitignore` com exceção `!.claude/memory/` — `settings.local.json` (tem senha) e `skills/`/`worktrees/` seguem ignorados.
- `…/projects/-home-marco-claude-genesis/memory/` — **symlink** → dir canônico (chave antiga; sem cópia separada, sem defasagem).

**Pipeline:** `sync_memory.py` (PostToolUse em Write|Edit) copia todo arquivo escrito no dir canônico → in-repo. Logo, **toda edição de memória vira mudança no working tree do git** (incl. atualizações do `coordenacao-sessoes.md`) — commitar para "versionar de verdade".

**⚠️ Sessões abertas da pasta-mãe (`~/claude/Projetos`) NÃO disparam o hook** (ele vive no `settings.local.json` do genesis) — a cópia in-repo defasa em silêncio (aconteceu em 2026-07-09: 2 sessões de trabalho sem sync). Ao fechar, sincronizar na mão: `cp <canônico>/*.md .claude/memory/` + commit `chore(memória)`.

**Hooks** (em `.claude/settings.local.json`): SessionStart faz `cat …-home-marco-claude-genesis/memory/coordenacao-sessoes.md` (resolve via symlink → atual); PostToolUse roda `…/claude/genesis/.claude/sync_memory.py` (resolve via symlink). Não precisam ser editados graças aos symlinks.

**How to apply:** ao salvar memória, escreva em `…-Projetos-genesis/memory/` e atualize `MEMORY.md`; depois commite `.claude/memory/` se quiser no remoto. Ver [[coordenacao-sessoes]] e [[salvar-erros-em-memoria]].
