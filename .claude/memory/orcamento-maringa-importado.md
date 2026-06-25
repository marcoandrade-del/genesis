---
name: orcamento-maringa-importado
description: LOA 2026 real da Prefeitura de Maringá importada no banco dev (previsões+dotações) a partir da API do Portal da Transparência; caveats fonte-9999 e receita bruta
metadata: 
  node_type: memory
  type: project
  originSessionId: faf85129-0b8e-4d19-8f1f-1e0173fcbe15
---

# Orçamento Maringá 2026 importado (2026-06-12)

A pedido do Marco, a **LOA 2026 da Prefeitura de Maringá** (Lei nº 12.100, de 23/12/2025) foi importada no banco dev para a entidade `b186d24e` (Prefeitura do Município, Maringá/PR), a partir da **API do Portal da Transparência** (Elotech): `https://transparencia.maringa.pr.gov.br/portaltransparencia-api`.

- `Orcamento` `cc42549a` (ano 2026, APROVADO, lei/data reais) — caveats em `observacoes`.
- **403 PrevisaoReceita** (natureza×fonte) = R$ 3.170.223.793,00 (**bruta**; deduções de R$ 327,5 mi não são publicadas por fonte → receita líquida = despesa).
- **2.325 DotacaoDespesa** = R$ 2.842.650.399,00 (exato). 53 dotações com valor inicial 0 (créditos especiais pós-LOA) puladas; créditos adicionais NÃO importados.
- Dimensões criadas: 73 fontes TCE-PR (4 dígitos, origem DESDOBRAMENTO — convivem com as 3 STN 500/540/600 do modelo), 49 UOs, 24 programas (tipo por heurística), 253 ações, função 99 + subfunções 245/608/999, 291 desdobramentos municipais no plano de receita (53 contas MODELO viraram sintéticas ao ganhar filho).
- ⚠️ **Fonte 9999 "Fonte não discriminada"**: o portal NÃO publica fonte por dotação de despesa (esgotado: API ignora filtro, LOA publicada é só o texto da lei, QDD só existia p/ 2016) → todas as dotações usam a 9999. Relatórios de despesa por fonte ficam todos nela.
- 2.295/2.325 dotações apontam p/ conta de **elemento** (sintética no plano TCE, que desdobra abaixo) — a LOA fixa por elemento; execução por desdobramento exigirá tratamento.

Script: `scripts/importar_orcamento_maringa_2026.ts` (dry-run default, `--apply`, `--substituir`; revalida somas na transação). Endpoints úteis descobertos: `/api/receitas?entidade=1&exercicio=` (árvore), `/api/receitas/fonte-recursos[/detalhes]`, `/despesapornivel/detalhada` (headers `entidade`/`exercicio`!). Ver [[contabil-regras-orcamentario]] e [[contabil-import-massa-bypassa-sync]].
