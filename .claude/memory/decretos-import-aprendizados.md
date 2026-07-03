---
name: decretos-import-aprendizados
description: "IMPORT DOS DECRETOS CONCLUÍDO (2026-07-03, PR #192): API decifrada (saldoAtualizado=atual; par {delta, atual−delta} em ordem AMBÍGUA), solver por dotação, 219 decretos lançados, 0 divergências × portal, Σ 3.325.289.298,63"
metadata:
  type: project
---

# Import dos decretos de Maringá — CONCLUÍDO (2026-07-03)

**PR #192** (branch `feat/creditos-decretos-reais`): 219 decretos lançados no
dev via CreditosAdicionaisService; **0 dotações divergentes do portal**;
Σ autorizado = **3.325.289.298,63** (Δ 0,00). Metas: Despesa Δ **+482,6mi**
visível; Guardião reagiu (Pessoal 44,2→46,0%, MDE 35,89%). 140 fontes e 441
dotações-fonte criadas (superávit 2xxx, convênios 5xxxx).

## O MODELO da API `/api/creditosadicionais` (a lição de ouro p/ APIs Elotech)
1. `saldoAtualizado` = valor ATUAL da dotação (constante em todos os registros
   da dotação — NÃO é saldo corrente da época).
2. Cada registro traz o par **{delta do decreto, atual−delta}** nos campos
   `(valorInicial, valor)` **EM ORDEM AMBÍGUA** — a identidade ini+val=saldo é
   simétrica e NÃO discrimina. Reduzida = delta negativo; há estornos com a
   natureza do doc original (sinal invertido).
3. **Desambiguação = equação por dotação**: Σ deltas = atual − LOA(nossa).
   Solver DFS custo-mínimo, delta ∈ {±ini, ±val} (custos 0/1/2/2), poda por
   soma alcançável, 3M nós: 408 padrão + 647 flips + 85 com **item de
   conciliação explícito** no doc S/N (rastreável, Σ −68,1mi).
4. Itens decreto "null/null" = movimentos reais sem número → doc "S/N-2026",
   aplicado POR ÚLTIMO (concilia no estado final).
5. Netting por dotação dentro de cada decreto (o service valida anulação
   contra o saldo PRÉ-documento).
6. Retomada idempotente: pula números já lançados; base do solver = atual −
   Σ créditos já lançados (aprendido na prática: 1ª aplicação parou em
   214/219 e retomou limpa).

## Armadilhas que custaram horas (não repetir)
- Hipótese "ordem = nº do decreto" → 475 resíduos (falsa).
- Hipótese "antes encadeia como razão corrente" → cadeias-ilha (falsa).
- "Âncora de estado final" reescrevendo documentos em massa → infiel (não usar).
- A simulação-guard bloqueou o --apply 2× por motivos REAIS. Num ledger,
  quando o guard acusa, é dado — não bug.

**How to apply:** próximos imports Elotech (execução, outras entidades):
suspeitar de campos espelhados/ambíguos; validar identidades em TODA a base;
ancorar em invariantes por linha (valor atual) e resolver por equação. Ver
[[portal-maringa-api-arquivos]], [[alteracoes-orcamentarias-dinamica]].
Snapshot: `data/creditos_portal_snapshot_2026-07-02.json`.
