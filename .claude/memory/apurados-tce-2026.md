---
name: apurados-tce-2026
description: "Apurados oficiais de Maringá 2026 (TCE/audiências, 1º quad + jun): receita 1.732,2mi, despesa empenhada 1.746,4mi, primário +320,89, nominal abaixo-da-linha +402,12, DCL −539,62 — checksums-alvo pros imports de execução"
metadata:
  type: reference
---

# Apurados oficiais Maringá 2026 (TCE / audiências públicas)

Trazidos pelo Marco em 2026-07-02 (site do TCE + slides das audiências).
São APURADOS de execução — **não confundir com as metas da LDO**.

| Indicador | Valor oficial | Período | No Gênesis |
|---|---|---|---|
| Receita arrecadada | R$ 1.732.158.223,59 | até jun/2026 | 1.461,2mi (jan–mai, 97% cobertura, #167) — **falta importar junho** |
| Despesa empenhada | R$ 1.746.396.980,01 | até jun/2026 | 0 (execução não importada) — **checksum-alvo do import** |
| Receita primária | R$ 1.184,21mi | 1º quad | — |
| Despesa primária | R$ 863,32mi | 1º quad | — |
| Resultado primário (acima da linha) | +R$ 320,89mi | 1º quad | = 1.184,21−863,32 ✓ |
| Resultado nominal (acima da linha) | +R$ 343,15mi | 1º quad | = primário + juros 22,26 ✓ |
| Resultado nominal (ABAIXO da linha) | +R$ 402,12mi | 1º quad | metodologia distinta (variação da DCL) |
| Dívida Consolidada | R$ 544,32mi | saldo atual | — |
| Disponibilidade de caixa líquida | R$ 1.083,94mi | saldo atual | alvo do import de saldos bancários reais |
| DCL | **−R$ 539,62mi** (−18,62% RCL ajustada) | saldo atual | cadastrada como meta + indicador do Guardião (#191) |
| DCL saldo INICIAL 2026 | **−R$ 137.507.930,95** | 1º/jan (herdado de 2025) | deep search; base do nominal ao vivo |
| Resultado nominal apurado EXATO | +R$ 402.115.811,24 | 1º quad | = ΔDCL: −137,51 − 402,12 = −539,62 ✓ FECHA AO CENTAVO |

**Metas da LDO 2026 (cadastro MetaFiscal): 5/5 COMPLETAS.** Receita
3.170.223.793 · Despesa 2.842.650.399 (LOA, Δ=0) · Primário −56,02mi (slides,
rótulo "META FISCAL") · Nominal −206.708.509,11 (AMF via Gemini, corroborado
2×, coerente com a DCL) · DCL −539,62mi. Os 343,15/402,12 são APURADOS do 1º
quad — nunca cadastrar como meta. ⚠️ Deep search contradisse o slide na meta
do primário (disse 0,00 genérico; slide oficial diz −56,02 — MANTIDO −56,02)
e deu meta DCL 0,00 (genérico; mantida a posição −539,62 como referência).
Convenção de sinal do nominal: apurado POSITIVO = dívida caiu; cravar
convenção ao computar ao vivo. Ver [[feedback-gemini-deep-search]].

**Corroboração (2º resumo Gemini, 2026-07-02):** LOA 3,58bi ✓ · meta nominal
−206,7mi ✓ (mesmo valor em duas respostas) · DCL −539,62 ✓ · empenhado 1,74bi ✓.
⚠️ arrecadação até jun veio 1,71bi (antes: 1,732bi) — arredondamento ou escopo
prefeitura×consolidado; o import de junho arbitra.

**How to apply:** esses números são os gabaritos de conferência dos imports
futuros (arrecadação de junho; execução da despesa ≈1.746,4mi empenhado até
jun; saldos bancários ≈1.083,94mi). Divergência grande = investigar antes de
gravar. Ver [[lrf-despesa-epico-plano]], [[alteracoes-orcamentarias-dinamica]].
