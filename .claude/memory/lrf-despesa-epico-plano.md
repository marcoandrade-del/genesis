---
name: lrf-despesa-epico-plano
description: "Plano recuperado do épico LRF-despesa (7 tarefas, sessão remota 01EBXUKBGwtgfYBNy6Xi6j3K de 28/06): o que já entrou (#1/#2), o que falta (#3-#7), e o gate do QDD da Elotech"
metadata:
  type: project
---

# Épico LRF-despesa — plano recuperado (2026-07-02)

Plano desenhado em 2026-06-28 pela sessão remota `01EBXUKBGwtgfYBNy6Xi6j3K`
(transcript local `d45cf36d`), recuperado do transcript em 2026-07-02 após a
sessão cair (bateria). A sessão pivotou pro épico de Memoriais (#176→#184,
concluído) antes de terminar este. Nenhum código foi perdido — tudo que ela
produziu está no master.

## Status das 7 tarefas

| # | Peça | Status |
|---|------|--------|
| 1 | `fonte-classificacao.ts` — fonte→finalidade por Estado, `porFinalidade` em arrecadações/saldo, API saldo-fonte 1.2.0 | ✅ mergeado (absorvido por #161) |
| 2 | `despesa-pessoal.ts` — RGF Anexo 1 (inclusões 3.1 + 3.3.90.34 − exclusões), tela+PDF, Guardião 1.3.0 | ✅ mergeado (#174/#176) |
| 3 | `indice-constitucional.ts` — MDE 25% / ASPS 15% fiéis | ✅ **FEITA 2026-07-02 (PRs #186 service+Guardião+API 1.5.0, #187 tela+PDF+card)**. MDE = func 12 × fontes 1101-1104 (salário-educação 1107 FORA); ASPS = func 10 × fonte 1303 próprios (SUS federal FORA, LC 141); base = 1.1.1 + FPM/ITR/ICMS/IPVA/IPI (CIDE fora). Composição default por Estado em código (`COMPOSICAO_INDICES_POR_ESTADO`); **editável na bancada = follow-up**. Nivel novo `abaixo_minimo` (limite MÍNIMO). Ao vivo: base 1,725bi, MDE 36,09%, ASPS 16,06% |
| 4 | `despesa-funcao-rreo.ts` — demonstrativo despesa por função (RREO); reusa `saldoSvc.calcular().porFuncao`; sem schema | ⏳ falta |
| 5 | `MetaFiscal` — modelo (entidade/ano/tipo/valorMeta/exercicioReferencia) + migração + CRUD admin + meta × projetado + API | ⏳ falta |
| 6 | **Import do QDD** — fonte por dotação | ✅ **FEITA 2026-07-02 (PR #185)** — ver abaixo |
| 7 | Disponibilidade por fonte (caixa 1.1.1.x por `ContaBancaria.fonteCodigo`) + Restos a Pagar (`MovimentoEmpenho` empenhado−liquidado/pago) — RGF Anexo 5 | ⏳ falta — **DESTRAVADA** (parte "por fonte") |

## GATE DESTRAVADO (2026-07-02) — como foi

O QDD oficial estava dentro do **PDF da LOA 2026** (Lei 12.100, 914 p.,
`data/Material didático/LOA 2026 Maringá.pdf`), **Anexo XXIV**: hierarquia
dotação → natureza → fonte com valor, órgãos 01–61 (Câmara, Prefeitura,
indiretas). Não precisou de export interno da Elotech pra fixada.

- `scripts/qdd_loa_pdf_para_csv.py` → `data/qdd_loa_2026_maringa.csv`
  (2.824 linhas; valida Σ = R$ 3.582.003.907,00 ao centavo).
- `scripts/importar_qdd_fontes_2026.ts` (dry-run/--apply) — **aplicado no dev**:
  2.325/2.325 dotações casadas, 206 desdobramentos multi-fonte (→2.531),
  fonte 9999 ZERADA, Σ preservada (2.842.650.399). Fonte nova: 99999 Reserva.
- **Validação independente**: balancete da despesa Elotech jan–mai
  (`data/balancete_despesa_2026_jan-mai_elotech.xlsx`, traz reduzido +
  execução) — 71 fontes, match ao centavo em todas.
- Despesa por finalidade agora REAL e espelha a receita (equilíbrio por fonte):
  MDE 377,9mi · ASPS 766,5mi · FUNDEB 281,1mi · Dívida 131,2mi ·
  Livres 929,3mi · NÃO-CLASSIF 356,6mi (fontes sem regra: 1001, 99999… —
  refinar regras via bancada de memoriais, não é problema de dado).

## Sequência recomendada
`#7` (RGF Anexo 5 — disponibilidade por fonte + restos a pagar) → `#4` (RREO
por função) → `#5` (Metas Fiscais). Follow-up também: composição dos índices
editável na bancada (4ª composição, exige coluna+migração+UI).

## Follow-ups anotados (fora do épico)
- Balancete Elotech tem **execução acumulada jan–mai** (empenhado/liquidado/
  pago por dotação×fonte, reduzidos) — importar exige decisão sobre o ledger
  (movimentos sintéticos? só acumulado, sem abertura mensal). Não feito.
- Suplementações jan–mai (autorizada − fixada no balancete) como créditos
  adicionais. Não feito.
- Orçamentos das outras entidades (Câmara 01, Previdência 31, autarquias
  50/60/61) estão no QDD/CSV prontos pra importar se um dia entrar
  consolidação municipal.

**Why:** o plano vivia só no transcript da sessão morta; sem este doc, o próximo
retomar do LRF-despesa teria que re-arqueologizar o jsonl de 10MB.
**How to apply:** ao retomar LRF-despesa, começar por aqui; conferir antes se
`indice-constitucional.ts`/`meta-fiscal` já surgiram (outra sessão pode ter
feito). Ver [[memoriais-editor-epico]] (resolver 3 níveis que #3 deve reusar),
[[contabil-rcl-lrf-plano]] e [[spec-realizacao-despesa-2026-06-22]] (QDD também
citado lá como "detalhar dotação por sub-elemento").
