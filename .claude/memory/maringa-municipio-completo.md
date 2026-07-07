---
name: maringa-municipio-completo
description: TODAS as entidades de Maringá povoadas (LOA QDD + execução do portal) — Câmara, Previdência, AMR, IPPLAM, IAM; mapa órgão↔entidade↔portal↔PIT e gabaritos; consolidação municipal habilitada
metadata:
  type: project
---

# Maringá: município completo (2026-07-07, #213)

Todas as entidades do município têm orçamento 2026 + execução jan–jun no dev.
Todas usam Elotech (mesmos endpoints do portal, só muda o id — regra do Marco:
"todas as entidades de Maringá usam o mesmo sistema").

## Mapa (órgão QDD ↔ entidade ↔ portal ↔ nome no PIT)
| órgão | entidade (banco) | portal | LOA (QDD) | exec jan–jun |
|---|---|---|---|---|
| 01 | Câmara do Município de Maringá | 6 | 72.158.007,00 | 31,85mi |
| 31 | Maringá Previdência | 3 | 638.922.114,00 | 173,31mi |
| 50 | Agência Maringaense de Regulação (AMR) | 9 | 2.176.035,00 | 0,94mi |
| 60 | IPPLAM (criada, ADM_INDIRETA) | 15 | 5.785.173,00 | 3,15mi |
| 61 | Instituto Ambiental - IAM (criada) | 4 | 20.312.179,00 | 6,85mi |

Prova de fechamento: Σ 739.353.508 + Prefeitura 2.842.650.399 = QDD total
3.582.003.907 AO CENTAVO. Execução: guard dashboard × nível 11 = 30/30
meses×entidades ao centavo. PIT (bruto×líquido): AMR −0,00%, demais −2,4 a
−10,7% (Previdência = estimativas RPPS anuladas).

## Scripts (master, #213)
- `importar_orcamento_entidades_2026.ts` (dry-run/--apply/--substituir) —
  QDD por órgão; criou subfunção 997 (Reserva Contingência RPPS) no catálogo
  global; IPPLAM/IAM nasceram via `EntidadeService.criar` (onboarding copia
  planos — NUNCA `entidade.create` cru; ressincronizador NÃO faz bootstrap).
- `importar_execucao_entidades_2026.ts` (--meses, --so) — portal por entidade
  (`/despesapornivel/detalhada` SEM prefixo /api + header `entidade`), padrão
  CAP-* idêntico ao sync; nomes de PROGRAMA são placeholder (QDD não publica).
- `importar_execucao_pit.ts --entidade-banco <nome>` — conciliação por entidade.

## Follow-ups
- Receita/previsões das entidades (telas de receita delas mostram vazio).
- Decretos/créditos adicionais das entidades (LOA delas está no valor inicial).
- Fontes "via decreto" da Previdência no de/para do PIT (cobertura informativa 47%).
- Job diário só sincroniza a Prefeitura (`ENTIDADE_PORTAL='1'` hardcoded no
  sync) — generalizar p/ multi-entidade é decisão da sessão SYNC.
- Consolidado RGF/DCL pode agora SOMAR entidades (RPPS na entidade certa).
