---
name: alteracoes-orcamentarias-dinamica
description: "Regra do Marco: decretos de suplementação/redução mudam o autorizado durante o ano — o sistema tem que prever. Como o Gênesis já cobre (autorizado vivo + meta fixa) e os gaps (importar decretos reais de Maringá)"
metadata:
  type: feedback
---

# Alterações orçamentárias durante o exercício (decretos)

**DECISÃO (2026-07-03): sincronização automática NÍVEL 2 aprovada pelo Marco**
— job DENTRO do Gênesis (scheduler + log persistido + validação contra o
dashboard ANTES de gravar; divergência = loga e não grava). v1 = arrecadação
mensal automática. **A DESPESA vai seguir o MESMO esquema** (sync de execução
da despesa no mesmo molde, sempre DEPOIS da receita do ciclo). Decretos-sync
automático = fase 2 (script manual idempotente enquanto isso). Tela
"Conectores" por entidade (botão sincronizar, toggle, alertas) = épico nível 3;
**semente já existe (2026-07-06, PR #200): tela `/app/sincronizacao`** (item
"Sincronização" no menu) com botão "Sincronizar agora" (receita→despesa do mês
corrente, assíncrono, trava por entidade, ESCRITA/ADMIN) + log das execuções +
estado do agendamento. Falta do épico: toggle por entidade, alertas, decretos.
Sync grava EXECUÇÃO CAPTURADA (painéis/indicadores) — NUNCA escrituração
contábil automática.

**Regra de ordem do Marco (2026-07-03): RECEITA sempre antes da DESPESA** —
"precisa ter dinheiro antes de gastar". Vale pra sequência dos imports de
execução (arrecadação do mês entra antes da execução da despesa do mês) e
reflete a lógica fiscal (suplementação por excesso de arrecadação pressupõe
a receita reconhecida).

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
