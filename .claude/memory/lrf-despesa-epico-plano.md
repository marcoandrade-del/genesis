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
| 3 | `indice-constitucional.ts` — MDE 25% (func 12 × fontes MDE\|FUNDEB) / ASPS 15% (func 10 × fontes ASPS); denominador impostos+transferências; Guardião 1.4.0; API `/memoriais/indices-constitucionais` | ⏳ falta — esqueleto dá sem QDD (números informativos); **fiel só com QDD** |
| 4 | `despesa-funcao-rreo.ts` — demonstrativo despesa por função (RREO); reusa `saldoSvc.calcular().porFuncao`; sem schema | ⏳ falta — **NÃO gated**, candidato imediato |
| 5 | `MetaFiscal` — modelo (entidade/ano/tipo/valorMeta/exercicioReferencia) + migração + CRUD admin + meta × projetado + API | ⏳ falta — **NÃO gated** |
| 6 | **Import do QDD** — parser xlsx→csv + import TS; tabela ref MarcadorTceNatureza/Fonte; refina RCL/fonte-classificacao/despesa-pessoal | 🔒 **GATED: xlsx que o Marco traz da Elotech** |
| 7 | Disponibilidade por fonte (caixa 1.1.1.x por `ContaBancaria.fonteCodigo`) + Restos a Pagar (`MovimentoEmpenho` empenhado−liquidado/pago) — RGF Anexo 5 | ⏳ falta — parte "por fonte" gated no QDD |

## O gate do QDD (por que trava #3/#6/#7)

A LOA importada de Maringá **não tem fonte por dotação** — o portal não publica
(API ignora o filtro; QDD público só existia p/ 2016). Resultado: **100% da
despesa está na fonte 9999** ("Não classificada") — ver
`memorial-saldo-fonte.ts:20` e [[orcamento-maringa-importado]]. MDE/ASPS reais e
o Anexo 5 por fonte exigem saber qual fonte financia cada dotação.

**Destrave:** export do sistema da Elotech (ERP do município — a fonte existe lá
na origem), xlsx/CSV, 1 linha por dotação, com: classificação institucional+
funcional-programática, natureza, **código da fonte de recurso** e valor fixado
(execução se tiver). Com isso a #6 roda, a despesa sai da 9999 e #3/#7 viram fiéis.

## Sequência recomendada
`#6 assim que o xlsx chegar` (multiplicador) → `#3 fiel` → `#7`.
Enquanto não chega: `#4` e `#5` (independentes, valor visível).

**Why:** o plano vivia só no transcript da sessão morta; sem este doc, o próximo
retomar do LRF-despesa teria que re-arqueologizar o jsonl de 10MB.
**How to apply:** ao retomar LRF-despesa, começar por aqui; conferir antes se
`indice-constitucional.ts`/`meta-fiscal` já surgiram (outra sessão pode ter
feito). Ver [[memoriais-editor-epico]] (resolver 3 níveis que #3 deve reusar),
[[contabil-rcl-lrf-plano]] e [[spec-realizacao-despesa-2026-06-22]] (QDD também
citado lá como "detalhar dotação por sub-elemento").
