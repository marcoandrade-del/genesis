---
name: saldos-abertura-2026-maringa
description: Saldos de abertura 2026 de Maringá CRAVADOS dos documentos oficiais do portal — 775,08mi conta a conta por fonte, DC 643,26mi composta, DCL inicial −137.505.240,95 (corrige o Gemini em R$ 2.690)
metadata:
  type: project
---

# Saldos de abertura 2026 — Maringá (CRAVADOS 2026-07-06)

Fonte: 3 documentos oficiais do portal (Elotech), salvos em `data/abertura-2026/`:
`/api/files/arquivo/2712615` (Saldos Bancários 31/12/2025), `2697476` (RGF Anexo 5
anual 2025), `2694672` (RGF Anexo 2, 3º quad 2025). Ver [[portal-maringa-api-arquivos]]
— grupo "Financeiro > Saldos de Contas Bancárias" tem TODOS os meses (2026 tb!).

## Os números (31/12/2025 = abertura 2026)

**Saldos bancários da Prefeitura: R$ 775.079.908,05** — 333 contas, 275 pares
conta×fonte (parse validado Δ0,00 vs totais de agrupamento; JSON por fonte em
`data/abertura-2026/saldos_por_fonte_31-12-2025.json`). Top: 1000=84,8mi ·
1104=76,5mi · 1486=73,5mi · 1507=60,8mi. ⚠️ fontes têm 3–6 dígitos (11045, 41687).

**✅ TRIPLO CRUZAMENTO AO CENTAVO (conferido a pedido do Marco, 2026-07-06):**
o MESMO 775.079.908,05 aparece em (1) Σ da relação de contas bancárias, (2)
Balanço Financeiro Anexo XIII dez/2025 "Saldo p/ o Exercício Seguinte — Caixa e
Equivalentes" (id 2710866) e (3) Balanço Patrimonial Anexo XIV dez/2025 conta
"Caixa e Equivalentes de Caixa" do plano de contas (id 2711112). Escrituração
contábil × relação bancária × balanço = consistentes. Caixa 31/12/2024 (abertura
2025): 621.530.064,76 (mesmos docs). Saldos MENSAIS 2026 já publicados
jan–mai: idArquivo 2898323–2898328 (grupo Financeiro > Saldos de Contas
Bancárias, exercicio=2026) — insumo do sync de saldos.

**DC (I) = 643.261.652,56** (RGF Anexo 2 consolidado) — composição p/ cadastro:
- Contratual 590.192.058,67: empréstimos internos 410.312.618,46 + externos
  26.597.175,66 + reestruturação 132.076.499,64 + parcelamentos 21.205.764,91
  (tributos 14.336.456,66; previdenciário 6.869.308,25)
- Precatórios pós-05/05/2000: 53.069.593,89 · Mobiliária/Outras: 0

**Deduções (II) = 780.766.893,51** (consolidado): caixa bruta 808.887.970,26 −
RP processados 8.108.741,45 − depósitos restituíveis 20.012.335,30.
(Δ caixa consolidada 808,89 × Prefeitura 775,08 = outras entidades.)

**DCL 31/12/2025 = −137.505.240,95** (−4,99% da RCL ajustada 2.756.722.478,46).
⚠️ CORRIGE o deep search do Gemini (−137.507.930,95; Δ R$ 2.690) — documento
oficial manda. Cadeia fecha: −137.505.240,95 − nominal 402.115.811,24 =
−539.621.052,19 ≈ DCL jun/2026 do TCE (−539,62mi) ✓. Atualizar tb em
[[apurados-tce-2026]]. DCL 31/12/2024 = −32.129.039,03 (mesma tabela).

Anexo 5 anual consolidado: não vinculados 325,04mi bruta / vinculados (ex-RPPS)
524,36mi / RPPS 1.308,6mi (Maringá Previdência — entidade própria, fora do nosso
banco da Prefeitura).

## Auditoria de consistência do fechamento 2025 (pedida pelo Marco, 2026-07-06)
12 docs oficiais cruzados (em `data/abertura-2026/`). **✅ AO CENTAVO**: RCL 2025
2.771.688.893,46 idêntica em RREO A3 × RGF A2 × caderno da audiência; RCL ajustada
2.756.722.478,46 idem; DC 643.261.652,56 e DCL −137.505.240,95 idênticas em RREO A6
× RGF A2; **nominal abaixo da linha 105.376.201,92 = ΔDCL exato** (−32.129.039,03 →
−137.505.240,95); receita consolidada 3.260,73mi e despesa empenhada 2.957,75mi
idênticas em RREO A1 × caderno; caixa 775.079.908,05 em 3 docs (acima).
**⚠️ 2 INCONSISTÊNCIAS REAIS (timing de fechamento, não fraude):** (1) o Balanço
Financeiro dez/2025 publicado NÃO fecha internamente — ingressos 3.789.259.795,33 ≠
dispêndios 3.816.741.636,91, Δ 27.481.841,58 = linha "Inscrição de RP" ZERADA na
coluna 2025 (2024 tinha 307,9mi; BF gerado 20/02/2026, antes da rotina de inscrição);
(2) balancete da receita (gerado 24/02) tem +896.247,17 vs BF (20/02) — rubrica exata
"2.4.2.9.99.0.1.13 Pacto pela Inovação SEIA 118/2025 FMCTI", lançada entre as duas
gerações. Lição: docs Elotech carimbam data de geração no rodapé — SEMPRE conferir;
a versão definitiva sai na Prestação de Contas Anual ao TCE. Nominal ACIMA da linha
2025 = 97.458.298,98 (Δ7,9mi vs abaixo = metodologias distintas, normal).
**Metas LDO 2025 oficiais (do RREO A6):** primário −104.054.473,00 · nominal
+38.062.992,43 (bônus p/ série histórica de MetaFiscal).

## ✅ IMPORT EXECUTADO (2026-07-07) — backlog nº 1 FECHADO
`scripts/importar_saldos_bancarios_2026.ts` (--apply): 378 ContaBancaria reais
(conta×fonte; multi-fonte = sufixo #fonte no número) + 1.729 MovimentoBancario
(abertura 01/01 exata 775.079.908,05 + ajustes mensais jan–mai; mai =
1.042.670.117,24 ao centavo; lote PORTAL_SALDOS_2026, idempotente). DC cadastro
= posição composta 30/04/2026 (`atualizar_dc_maringa_2026.ts`, 544.316.158,21 =
TCE). **DCL viva = −433.005.728,05** (`verificar_dcl_viva.ts`); Δ106,6mi vs
oficial −539.616.064,25 decomposto: corte mai×abr 41,5 + consolidado×Prefeitura
40,3 + RP proc da captura CAP-* 42,5 − depósitos restituíveis 17,7. Colisão com
o seed sintético #210 (17 contas RGF1Q26-*) resolvida com autorização do Marco
(sintéticas removidas; racional no board). ⚠️ REVISÃO OFICIAL: o RGF A2 do
1ºQ/2026 (id 2898579) REVISOU a DCL inicial p/ **−137.507.930,95** (o valor do
Gemini!) — o doc de 2025 (−137.505.240,95) era pré-revisão, Δ2.690 nos RP proc.
Follow-ups: refinar deduções MDF no DclService (RP proc, depósitos, corte ?q=);
saldos mensais no sync automático (receita→despesa→saldos); parser exige
`pdftotext` no PATH.
