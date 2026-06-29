---
name: git-tree-compartilhada-entre-sessoes
description: As sessões Claude do Gênesis compartilham o MESMO repo/.git/índice/working-tree — cuidados pra não absorver/embaralhar o trabalho de outra sessão
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 431b9bde-a8b1-4b3b-a10b-481a9bc6be88
---

Várias sessões Claude trabalham no MESMO diretório `Projetos/genesis` (mesmo `.git`, índice e working-tree). Isso já mordeu 3×: (a) minha branch nasceu do master LOCAL que tinha o commit de outra sessão → o squash do meu PR **absorveu** o trabalho dela (#161 absorveu o LRF d896ecd; nada perdido, mas confuso); (b) um arquivo **untracked** de outra sessão (script da #165) estava **staged no índice compartilhado** → entrou no MEU commit; (c) `git pull --ff-only` falha (divergência do master local OU untracked que o origin passou a trackear).

**Why:** índice e working-tree são um só entre as sessões; `git add` de arquivos específicos NÃO impede que algo pré-staged por outra sessão entre no `git commit` (commit pega TUDO que está staged).

**How to apply:**
- **Antes de commitar:** `git add` só dos MEUS arquivos E confira com `git show --stat HEAD` (ou `git diff --cached --name-only`) que NÃO entrou arquivo de outra sessão. Se entrou: `git reset --soft HEAD~1` → `git restore --staged <arquivo-alheio>` → recommit → `git push --force-with-lease`.
- **Nome de branch ÚNICO** (conferir `git branch -a` antes) — nomes repetidos embaralham refs/HEAD.
- **Recuperar master local divergente:** se `git log origin/master..master` está VAZIO e meu trabalho já está no `origin/master` (e o das outras sessões também, nas branches/PRs delas), `git reset --hard origin/master` é seguro (nada se perde — tudo está no origin). Antes, **preserve arquivos não-commitados de quadro/memória** (copiar) e, se `ff` abortar por untracked que o origin trackeia, o reset --hard resolve.
- **Quadro/memória** (`.claude/memory/*.md`) é editado por várias sessões → reconciliar (preservar a nota da outra + prepend a minha), nunca sobrescrever cego.

Relacionado: [[merge-stack-squash-x-ours]], [[feedback-nao-operar-worktree-de-outra-sessao]], [[coordenacao-sessoes]].
