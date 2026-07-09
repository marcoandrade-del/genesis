---
name: decretos-import-aprendizados
description: "Decretos da API Elotech: par {delta, atual−delta} AMBÍGUO, solver por equação com retomada INCREMENTAL (#220); AUTOMATIZADO no sync diário (#222/#223, núcleo decretos-solver.ts) com histórico na tela (#224); 229 lançados, Δ 0,00 × portal"
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
6. Retomada idempotente: pula números já lançados. **⚠️ CORRIGIDO em
   2026-07-08 (PR #220): a retomada resolve SÓ OS PENDENTES contra o
   autorizado ATUAL do banco.** Re-resolver a história completa redistribuía
   os flips entre lançados (imutáveis) e pendentes — mesma soma por dotação,
   delta individual errado (decreto 1218/2026 recebeu anulação de 1.192.870,15
   em vez de 12.650,74; o guard de saldo disponível barrou). Conciliação de
   cada rodada ganha `S/N-<data>` próprio (o S/N antigo é imutável).
7. **AUTOMATIZADO (2026-07-08, #222/#223): decretos entraram no sync diário**
   (`SincronizacaoDecretosService`, antes de receita→despesa; núcleo puro em
   `decretos-solver.ts`, compartilhado com o script). O sync só lança equação
   exata; recusa (DIVERGENTE) conciliação/S-N/drift/ordem-inviável → aí sim
   rodar o script manual. Item null/null NOVO pós-S/N: o script concilia POR
   DIFERENÇA (atual − banco) num `S/N-<data>` (caso real: 53.600,00 em
   08.010...3.3.90.93 f2303). Estado: 229 decretos, Δ 0,00 × portal.

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
