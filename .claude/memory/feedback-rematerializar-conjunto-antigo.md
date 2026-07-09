---
name: feedback-rematerializar-conjunto-antigo
description: "Quem reescreve movimentos deve rematerializar o conjunto ANTIGO ∪ NOVO — re-run que redistribui deixa órfãos com materializado velho (bug real do #217, fix #218)"
metadata:
  type: feedback
---

# Rematerializar o conjunto ANTIGO ∪ NOVO ao reescrever movimentos

Erro real (2026-07-07/08): o rateio com teto (#217) mudou QUAIS dotações
recebem movimento no re-run idempotente da captura. A rematerialização de
`empenho.valor`/`dotacao.valorEmpenhado` só iterava as dotações dos deltas
NOVOS — quem perdeu todo o movimento do mês ficou com o materializado velho
(V2/V3 do selo divergiram Δ 1,45mi/6,97mi; ~100 fichas órfãs). Latente desde
sempre: o rateio proporcional atingia o mesmo conjunto a cada re-run, então
nunca se manifestou.

**Why:** padrão razão→materializado: `deleteMany(histórico)` + `createMany` +
rematerializa. Se o passo 3 usa só o conjunto novo, o delete do passo 1 pode
ter órfãos invisíveis.

**How to apply:** antes do `deleteMany`, coletar os ids DISTINTOS que tinham
movimento no histórico e uni-los ao conjunto novo na rematerialização
(fix #218 em `despesaMes`). O reparo do estrago já feito foi one-off
autorizado pelo Marco (rematerializou todas as fichas CAP-*, 70 corrigidas).
Vale para qualquer ledger com campos materializados: [[integracao-receita-eventos]]
(arrecadação re-materializa por previsão — lá o conjunto é por `previsaoId`,
mesmo risco se a distribuição mudar).
