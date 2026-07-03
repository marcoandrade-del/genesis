---
name: decretos-import-aprendizados
description: "Import dos decretos de Maringá (WIP na branch feat/creditos-decretos-reais): semântica dos campos validada, dedup de estornos, itens S/N; BLOQUEIO = ordem real dos movimentos ≠ nº do decreto (475 resíduos) — próximo passo: cadeia antes→saldo por dotação"
metadata:
  type: project
---

# Import dos decretos de Maringá — estado e aprendizados (2026-07-03)

Branch **`feat/creditos-decretos-reais`** (pushada, sem PR):
- ✅ `CreditosAdicionaisService` relaxado p/ decretos reais: aceita
  só-anulação (36 contingenciamentos) e anulação>reforço (12); mantém ≥1
  item, valor>0, anulação≤saldoDisponivel. 11/11 testes.
- ⚠️ `scripts/importar_decretos_2026.ts` **WIP — dry-run BLOQUEIA (correto)**.

## Semântica do `/api/creditosadicionais` (validada, 0 inconsistências/1.782)
- Suplementar: antes=`valorInicial`, delta=+`valor`
- Reduzida: antes=`valor`, delta=−`valorInicial`  (campos trocam de papel!)
- saldoAtualizado = antes + delta, sempre.
- Estornos: Suplementar com delta NEGATIVO (ex.: decreto 205/2026).
- **Duplicatas**: certas anulações aparecem 2× (estorno Suplementar-negativo
  num decreto + Reduzida formal noutro, mesmo saldo final) — dedup implementado.
- 102 itens com decreto "null/null" = movimentos REAIS sem número
  (+58,9/−31,9 = +27,1mi) — entram como lançamento "S/N-2026".
- Dimensões: TODAS existem no banco (0 UO/função/programa/ação/conta
  faltando); faltam só ~38 fontes (superávit 2xxx, convênios 5xxxx).
- Efeito líquido bruto (sem dedup/ordem): +442,4mi → autorizado ~3,29bi.

## O BLOQUEIO (por que não aplicar ainda)
A ordem real dos movimentos NÃO é o número do decreto: os `antes` se
sobrepõem entre decretos → reconstruir por número gera **475 resíduos** e a
"âncora de estado final" que tentei reescreve documentos em massa (infiel).
**Próximo passo**: por dotação-fonte, ENCADEAR os movimentos por antes→saldo
(a ordem emerge da cadeia); a abertura da cadeia deve bater com nossa LOA
(divergência = investigar antes); só então emitir os decretos na ordem
inferida e validar Σ final. Gabarito: Σ autorizado esperável ~3,0–3,3bi
(conferir também contra `saldoAtualizado` por dotação e o balancete).

**Snapshot durável**: `data/creditos_portal_snapshot_2026-07-02.json` (o
FALLBACK_JSON do script ainda aponta pro scratchpad volátil — atualizar ao
retomar). Dados vivos: re-buscar na API (pode ter decretos novos).

**How to apply:** retomar pela branch; NÃO rodar --apply antes de resolver a
cadeia; a simulação do script é o guard-rail — se ela acusar, é dado, não bug.
Ver [[portal-maringa-api-arquivos]], [[alteracoes-orcamentarias-dinamica]].
