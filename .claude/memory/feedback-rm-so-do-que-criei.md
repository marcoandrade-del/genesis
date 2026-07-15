---
name: feedback-rm-so-do-que-criei
description: "Erro 2026-07-15: num rm de limpeza em lote, apaguei scripts/_demo_pdf.ts que era WIP UNTRACKED de outra frente (não meu) — untracked deletado é irrecuperável; só remover arquivo que EU criei NESTA sessão, conferindo um a um"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 689c5fca-4b0c-4a9d-802f-cbb7328d48f3
---

# rm de limpeza: só o que EU criei nesta sessão, conferido um a um

Ao limpar meus scripts-probe da árvore principal, incluí `scripts/_demo_pdf.ts`
no `rm -f` em lote — mas ele era **WIP untracked de outra frente** (estava no
git status desde o INÍCIO da sessão, antes de qualquer trabalho meu). Untracked
deletado = irrecuperável (sem git, sem lixeira).

**Why:** o prefixo `_` me fez presumir "sonda descartável minha"; a lista do rm
foi montada de memória, não conferida contra a lista do que eu criei.

**How to apply:**
- Antes de rm em árvore compartilhada: conferir CADA arquivo contra o registro
  do que EU criei NESTA sessão (o git status do início da sessão lista o que já
  existia — tudo que estava lá é de outrem).
- Em worktree próprio, rm é livre; na ÁRVORE PRINCIPAL (compartilhada, com WIP
  de outras frentes), tratar QUALQUER remoção como zona vermelha.
- Se apagar por engano: confessar imediatamente no board + ao Marco (feito).
