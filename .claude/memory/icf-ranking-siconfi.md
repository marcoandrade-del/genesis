---
name: icf-ranking-siconfi
description: "Ranking Siconfi / ICF (nota A–E) como alvo externo do Gênesis; metodologia das 185 verificações e gap-list para um \"medidor de ICF\" (keystone = emitir MSC)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 50efd566-11fe-4e56-8e0b-efaf7198ed26
---

# ICF / Ranking Siconfi como alvo do Gênesis

> ⚠️ **ESTADO (10/07/2026) — ler antes de retomar.** O **emissor de MSC já existe**: **PR #225** criou `src/services/matriz-saldos-contabeis.ts` (SI/MD/MC/SF por conta analítica × mês, saldo devedor com sinal, selo próprio Σ MD=Σ MC + balanço fecha Δ0, endpoint `GET /api/memoriais/msc`, contrato `memoriais-lrf 1.13.0`) e **PR #226** fez o motor da despesa carimbar a **fonte da dotação** no razão. O #225 **adiou de propósito** a quebra por **conta-corrente** (poder/órgão, fonte, natureza receita/despesa, função) = a "fase 2 (ICs)". **FASE 2 MERGEADA (#228, 2026-07-10):** `LinhaMsc` já tem `contaCorrente { fonte, naturezaReceita, dotacaoId, funcao }` em master — é o que ACENDE os 12 stubs do validador; rebasear o `validador-msc` em master e wire-ar `/memoriais/msc-validacao` (bump 1.15.0 sobre a 1.14.0 da #228). ⇒ Esta frente (ICF) **NÃO deve tocar `matriz-saldos-contabeis.ts`** — coordenar pelo quadro. O plano da "Fase 1" abaixo está **re-ancorado**: não é criar `msc.ts` do zero (o backbone existe), é ESTENDER o emissor pela dimensão conta-corrente — e isso é da outra sessão. O papel do ICF vira: consumir a MSC pronta e construir o **validador estrutural** (Dim I) + score no motor do Selo.

Disparado pela **Portaria STN/MF nº 1.833, de 24/06/2026** (DOU) — só DIVULGA o Ranking + o "IV Prêmio Qualidade da Informação Contábil e Fiscal" (dados de 2025); NÃO é norma técnica (base: Portaria STN/MF 807/2023). Ranking em https://ranking-municipios.tesouro.gov.br/. Maringá cai na categoria "municípios >100 mil hab.".

## Metodologia do ICF (Indicador da Qualidade da Informação Contábil e Fiscal)
- Nota = **% de acertos** em verificações automáticas sobre o que o ente ENVIOU ao Siconfi. **A** = >95%, **E** = <65% (5 faixas). Selo = nota A ("Aicf").
- Fontes: **DCA, RREO (6ºB), RGF (3ºQ/2ºS), MSC (Matriz de Saldos, mensal + dezembro)**. Corte 2026 = 10/05/2026.
- **185 verificações ativas em 2025**, 4 dimensões: I-Gestão (39), II-Contábil (74), III-Fiscal (44), IV-Contábil×Fiscal (28). Catálogo baixado de `descricao_ranking.csv` + `verificacoes_aplicabilidade.csv`; cópia legível ficou só no scratchpad (`catalogo_verificacoes_2026.md`) e **se perdeu no desligamento** — rebaixar do servidor do ranking quando for construir o validador estrutural (Etapa 4).

## De/para com o Gênesis (gap-list)
- **Guardião** (`src/services/memorial-guardiao.ts`, 9 indicadores) NÃO é o análogo — mede LIMITES da LRF (ortogonal ao ICF).
- Motor a reaproveitar = **Selo de Consistência** (`src/services/consistencia.ts`, V1–V8): mesmo padrão `Verificacao[]→selo`, envelope versionado `memoriais-lrf`. Hoje valida consistência INTERNA do razão, não os artefatos Siconfi.
- Gênesis TEM razão completo (`saldo-contabil.ts`/`razao-contabil.ts`/VPA-VPD/abertura/PCASP) e **RREO/RGF anexos VIVOS**, mas **NÃO emite MSC nem DCA** ← isso é a chave.
- **Vantagem única**: razão único → se emitir DCA+MSC do MESMO razão que gera RREO/RGF, os **28 cruzamentos da Dim IV passam por construção** (é onde os concorrentes perdem nota A). Teto honesto de auto-checagem ≈ 164/185; as 21 de entrega/prazo/retificação dependem do ATO de transmitir (fora de escopo de registro).

## Ordem de construção proposta
1. **Emissor de MSC** (keystone) — ✅ backbone MERGEADO (#225); a quebra por conta-corrente é a **fase 2, com OUTRA SESSÃO** (não é desta frente).
2. Validador estrutural da MSC → 18 checks da Dim I — ✅ **PR #231 ABERTO (sessão 50efd566, 2026-07-10)**: `src/services/validador-msc.ts` (fn pura `validarEstruturaMsc(linhas, {encerramento?})` + `ValidadorMscService`, reusa `Verificacao`/selo do `consistencia.ts`, consome `LinhaMsc` read-only) + endpoint `GET /memoriais/msc-validacao` (contrato **1.15.0**). **8 checks ATIVOS** (saldo invertido por natureza — ativo/passivo/PL/VPD/VPA/orçamentária separados; classes 1-8; fonte dígito-9 via `contaCorrente.fonte`) e **10 STUBS `NAO_APLICAVEL`** com id STN. Consolidou o validador que estava DUPLICADO com o `msc-validador.ts` da sessão do worktree `genesis-wt-msc-val` (fundiu passivo/PL separado + caminho de encerramento). Landado em worktree limpo off master (`feat/icf-validador-dim1`), 42 testes verdes, tsc limpo. **Follow-up PR:** ativar os 6 stubs de detalhamento por conta-corrente (receita/despesa sem natureza/função/fonte, atributo-F) — requer validar prefixos PCASP orçamentários com MSC real. **Lição:** `git worktree list` faz parte de "ler o board" em árvore multi-worktree (a duplicação teria sido evitada). 3. Cruzamentos Dim IV (28). 4. Emissor de DCA → Dim II (74). 5. Envolver RREO/RGF (44) como verificações pontuadas. 6. Score/Selo ICF (nota A–E) no envelope versionado, consumível pelo Oxy.
Fases 1–3 = pré-ICF real (~46 checks "perde-ponto") sem depender de DCA.

### 3 decisões que ficaram abertas no plano (default sugerido)
1. **Escopo**: MSC por-entidade primeiro (default) vs. já consolidada por ente.
2. **Saldo inicial patrimonial por fonte**: usar saldos de abertura 2026 já cravados por fonte em `data/abertura-2026/` (default) vs. estender `SaldoInicialAno` com conta-corrente.
3. **De/para poder/órgão**: derivar de `Entidade.tipo`+`Orgao[]` com tabelinha de override (default) vs. mapa de config explícito.

Relaciona: [[oxy-playbook-verificacao-narrativa]] (ideia /memoriais/consistencia com selo), [[mdf-rgf-tesouro-referencia]], [[oxy-dashboards-integracao]], [[tce-pr-pit-dados-abertos]].
