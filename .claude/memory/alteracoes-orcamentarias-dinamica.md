---
name: alteracoes-orcamentarias-dinamica
description: "Regra do Marco: decretos de suplementação/redução mudam o autorizado durante o ano — o sistema tem que prever. Como o Gênesis já cobre (autorizado vivo + meta fixa) e os gaps (importar decretos reais de Maringá)"
metadata:
  type: feedback
---

# Alterações orçamentárias durante o exercício (decretos)

Regra do Marco (2026-07-02): suplementações e reduções de dotação mudam os
números ao longo do ano — receita/despesa "da LOA" não são estáticas.

**Como o Gênesis já cobre:**
- `CreditosAdicionaisService` aplica cada decreto no `valorAutorizado`
  (REFORCO increment / ANULACAO decrement, transacional, imutável).
- TODOS os demonstrativos LRF leem o autorizado VIVO (índices MDE/ASPS,
  despesa-pessoal, RREO por função, Anexo 5, saldo por finalidade) → decreto
  entra, números movem sozinhos.
- Metas fiscais: meta = valor FIXO (cadastrado com a LOA INICIAL em
  2026-07-02, ANTES de qualquer crédito) × projetado = Σ autorizado vivo →
  o Δ mostra o desvio orçamentário acumulado. Não recadastrar a meta quando
  entrarem créditos — o Δ≠0 é a informação.

**Gaps pendentes:**
- Importar os decretos REAIS de Maringá (jan–mai+): o balancete Elotech dá o
  efeito líquido (autorizada−fixada por dotação + reduzidos novos); investigar
  na API do portal ([[portal-maringa-api-arquivos]]) endpoint de alterações
  orçamentárias p/ importar decreto a decreto via CreditosAdicionaisService.
- `scripts/importar_qdd_fontes_2026.ts` tem invariante Σ=2.842.650.399
  (LOA inicial) — quebra em re-execução pós-créditos; one-shot, inofensivo,
  mas ajustar se for reusar.

**Why:** evitar tratar os totais da LOA como constantes e "corrigir" o Δ das
metas como se fosse bug.
**How to apply:** ao importar execução/decretos, usar o módulo de créditos
(não editar valorAutorizado na mão); conferir que meta fiscal continua com o
valor INICIAL. Ver [[lrf-despesa-epico-plano]].
