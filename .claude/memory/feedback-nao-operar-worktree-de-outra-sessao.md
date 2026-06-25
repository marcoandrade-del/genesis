---
name: feedback-nao-operar-worktree-de-outra-sessao
description: A sessão coord não deve executar rebase/merge no worktree/branch de outra sessão; quem é dona da branch é que roda o comando
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7542ce95-c63e-418e-b797-cdff6fa00d54
---

Quando concluí o merge da stack Compras e pedi pra rebasear a frente **Relatórios** sobre o master novo, o Marco recusou: *"não, vou transferir o comando para a sessão própria de relatórios."*

**Regra:** a sessão de Manutenção/coord faz merges de PRs (via GitHub/`gh`) e atualiza memória, mas **NÃO entra no worktree/branch de outra sessão para rodar rebase/merge/commit lá**. Quem é dona da branch (ex.: a sessão Relatórios no worktree `/home/marco/claude/genesis-relatorios`) é que executa o próprio rebase.

**Why:** cada sessão tem contexto próprio do seu trabalho (inclusive mudanças não-commitadas no worktree dela que eu não enxergo); operar por cima cria risco de conflito/perda e quebra a ownership do protocolo de coordenação.

**How to apply:** ao concluir um merge que desbloqueia outra frente, eu só **sinalizo no quadro** ([[coordenacao-sessoes]]) que ela está liberada para rebasear — e paro aí. Não faço `cd` no worktree alheio nem rodo git nele, mesmo a pedido, a menos que o Marco diga explicitamente "rebaseia você mesmo aqui".

Relacionado: [[coordenacao-sessoes]], [[feedback-protocolo-coordenacao]].
