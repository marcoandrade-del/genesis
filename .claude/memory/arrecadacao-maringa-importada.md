---
name: arrecadacao-maringa-importada
description: "Execução da receita (arrecadação realizada) de Maringá 2026 no dev POR FONTE — fonte EXATA do relatório TCE-PR (jan-maio)"
metadata: 
  node_type: memory
  type: project
  originSessionId: d45cf36d-e015-4f59-af73-b40b4d0b8bee
---

# Arrecadação realizada de Maringá 2026 no dev (por fonte, EXATA)

A **execução da receita** (arrecadação REALIZADA) da Prefeitura de Maringá 2026 está
no banco dev, **por fonte de recurso, EXATA** (PR #167, `scripts/importar_arrecadacao_maringa_2026.ts`).
Complementa a LOA de [[orcamento-maringa-importado]] (previsão).

## Fontes de dados (Marco entregou as planilhas reais do TCE-PR, 29/06)
- **Realizado por natureza×fonte EXATO**: relatório oficial "Receita Realizada por Fonte"
  do TCE-PR, **jan–maio** (`data/receita_realizada_fonte_maringa_2026_jan-mai.xlsx` — gitignored,
  local, como o PCASP). É total do período, sem quebra mensal.
- **Forma MENSAL**: captura do portal #150 (`scripts/dados/receita-mensal-maringa-2026.json`,
  arrecadada por natureza mês a mês). Cada natureza×fonte exata é distribuída nos meses
  pela proporção mensal daquela natureza no portal (fallback: igual).
- **LOA prevista**: a planilha "LOA Receitas Previstas" CONFERE ao centavo com as previsões já
  no banco (total R$ 3.170.223.793) → previsão já estava exata, nada a refazer.

## Como grava
- **DADO** (`Arrecadacao` ARRECADACAO, data = fim do mês, valor BRUTO) + materializa
  `PrevisaoReceita.valorArrecadado`. **NÃO dispara contabilidade** — execução p/ painéis/
  `valores-mensais`/saldo-por-fonte, não escrituração. Idempotente (limpa por `historico`).

## Resultado (dev, jan–maio 2026)
- **1559 movimentos, R$ 1,46bi atribuído** (cobertura **97,02%**; 3% = realizado em
  natureza×fonte sem previsão na LOA — sobretudo ASPS/Outras, transferências de saúde acima do orçado).
- **FUNDEB R$ 122.093.775 e Dívida R$ 44.200.413 batem ao centavo** com o relatório do TCE.
- Mensal jan–maio (pico de fev = IPTU). **Junho fica de fora** até vir o relatório de junho por fonte.
- Histórico: o 1º import (#165) era jan–jun APROXIMADO (rateio pela LOA, 1817 movs); substituído por este EXATO.

## Consome
- Alimenta `valores-mensais` (Sessão OXY) e a conferência portal×Gênesis (#152) — leem no dev.
- Refino futuro: relatório de junho por fonte → estende para jan–jun exato.
