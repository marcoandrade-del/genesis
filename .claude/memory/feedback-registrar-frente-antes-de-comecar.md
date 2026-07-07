---
name: feedback-registrar-frente-antes-de-comecar
description: Colisão real 2026-07-07 — comecei "saldos bancários" sem registrar no quadro ANTES; outra sessão criou branch pra mesma frente em paralelo
metadata:
  type: feedback
---

Registrar a frente no quadro de coordenação **ANTES do primeiro comando**, não
no meio nem no fim — mesmo quando o pedido vem direto do Marco no chat (ele
pode pedir a mesma coisa a outra sessão, ou outra sessão pode pegar do backlog).

**Why:** em 2026-07-07 recebi "saldos bancários" do Marco e mergulhei direto
(sondagem, download, script, apply no dev). No meio do fluxo a árvore principal
apareceu na branch `feat/saldos-bancarios-2026` — outra sessão assumindo a MESMA
frente. Ela não tinha como saber: o quadro dizia "nada em andamento" da minha
parte. Sorte: ela ainda não tinha commit; sinalizei alto no quadro e não houve
retrabalho — mas foi corrida, não coordenação.

**How to apply:** o claim no quadro é a PRIMEIRA escrita da frente (uma linha:
sessão, o quê, zona). Só depois começa o trabalho. No fim, trocar o claim pelo
desfecho. Vale até p/ frentes "de dados" (import no dev) — zona de colisão
tanto quanto código.
