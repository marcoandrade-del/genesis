---
name: feedback-escrever-despesa-reconciliada
description: escreverDespesa espera linhas RECONCILIADAS (LOA+execução) — passar só a LOA varre o ledger CAP-* e a execução some do dev; sempre reconciliarDespesa antes
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 33369826-8471-4e55-bfce-06b40346017c
---

# escreverDespesa SÓ com linhas reconciliadas (LOA + execução)

Em 2026-07-22, no `importar_loa_cagepar.ts`, chamei `escreverDespesa` passando **só as 6 linhas da LOA**. O writer é destrutivo por design (idempotência do conversor): (1) **apaga TODO o ledger CAP-*** da entidade (`movimentoEmpenho`/`empenho` com `numero LIKE 'CAP-%'`) antes de recriar; (2) **deleta dotações órfãs** (fora da escrita atual, sem dependentes). Resultado: a execução da CAGEPAR (16 dotações PIT, 47 movimentos, empenhado 2.186.091,54) foi **varrida do dev** — só sobreviveram as dotações que ainda tinham lançamentos no razão.

**Why:** o contrato do `escreverDespesa` é receber o conjunto COMPLETO (LOA ∪ execução, via `reconciliarDespesa`) — o pipeline `importarMunicipio` sempre faz `reconciliarDespesa(loa, exec)` antes. Um caller avulso que passa subconjunto aciona a limpeza sobre o que ficou de fora. Mesmo espírito do [[feedback-rematerializar-conjunto-antigo]] (re-run que redistribui deixa órfãos).

**How to apply:**
- NUNCA chamar `escreverDespesa` com só-LOA ou só-execução: sempre `reconciliarDespesa(loa, exec)` antes (a exec vem de `pitTcePr.lerExecucao`/fonte do TCE — re-baixável, foi assim que recuperei).
- Recuperação provada: re-ler exec do PIT → reconciliar → reescrever → `AberturaContabilService.estornar` (se a fixação mudou) → `materializarRazao` → verificar 6.2.2.1.1/empenho bruto ao centavo.
- Sinal de alerta: `materializarRazao` reportando `0 movimentos` numa entidade que tinha execução = a execução sumiu; investigar antes de seguir.
