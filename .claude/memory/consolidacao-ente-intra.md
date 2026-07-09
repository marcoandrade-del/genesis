---
name: consolidacao-ente-intra
description: Consolidação de contas por ente (Município) com eliminação intra-OFSS — o marcador intra é DERIVÁVEL dos códigos (despesa mod 91, receita cat 7/8), sem schema novo; despesa consolidada feita (#216), RCL já correta, DCL/MSC futuras
metadata:
  type: project
---

# Consolidação por ente + eliminação intra-OFSS

Regra: o total do ENTE ≠ soma pura das entidades — elimina-se a parcela
intragovernamental (LRF art. 50 §1º; MCASP). Ex. Maringá: contribuição
patronal Prefeitura → RPPS (Maringá Previdência) contaria 2×.

## Descoberta-chave (baseou o desenho)
O marcador intra JÁ está na classificação contábil — **sem campo no schema**:
- **Despesa intra = modalidade 91** (3º grupo da natureza `x.x.91.xx`).
- **Receita intra = categoria 7/8** (1º dígito).
Helper: `src/services/natureza-intra.ts` (`ehDespesaIntra`/`ehReceitaIntra`).
Verificado no dev: Prefeitura tem 101 dotações mod 91.

## Feito (#216, contrato memoriais-lrf → 1.11.0)
`src/services/consolidacao.ts` `ConsolidacaoService.despesa(municipioId, ano)`:
soma MovimentoEmpenho das entidades ativas → bruto/intraEliminada/consolidado.
`GET /memoriais/despesa-consolidada` (via `MemorialRclService.despesaConsolidada`).
**Prova Maringá 2026 jan–jun: bruto 1.966,44mi − intra 44,58mi = 1.921,86mi**
(99% da intra = repasse ao RPPS). Complementa a V5 do selo #214 (equilíbrio
fecha ao consolidar).

## Já correto (não mexer achando que é bug)
**RCL consolidada** (`rcl-consolidada.ts`): soma só categoria 1 → NUNCA inclui
intra (cat 7), logo `intra=0` é CERTO. Hoje ≈ Prefeitura (outras entidades
sem receita importada).


## Fase 2 (receita) — FEITO (#219, contrato 1.12.0)
`ConsolidacaoService.receita` + `GET /memoriais/receita-consolidada` + import
`scripts/importar_receita_entidades_2026.ts` (receita real das entidades do
portal; RPPS 171,96mi incl. cat-7 44,51mi; IAM 1,63; AMR/IPPLAM centavos).
**Prova: receita intra cat-7 44.508.246,24 ≈ despesa intra mod-91 44.581.051,41
(#216) — a identidade da eliminação FECHA nos dois lados (Δ 0,16%, timing).**
Arrecadado consolidado ente 2026: 1.805,11mi (bruto 1.849,62 − 44,51).
RCL consolidada segue correta (cat 1 only). Cat-7 não existe no plano-modelo →
o import cria como desdobramento.

## Equilíbrio da LOA (V5 do selo) — RESOLVIDO (#221, 2026-07-08)
**O equilíbrio da Lei 4.320 é do MUNICÍPIO e é BRUTO** — a LOA oficial fecha
3.582.003.907,00 = 3.582.003.907,00 INCLUINDO as intra (não é a eliminação
que fecha a V5; a eliminação segue essencial p/ os CONSOLIDADOS acima). Por
entidade a identidade NÃO existe (a própria LOA publica a Prefeitura com
receita 3.170,2mi × QDD 2.842,7mi). V5 agrega as entidades ativas do
município. Pegadinha de dados: `valorPrevisto` deve ser o orçado INICIAL
(`valorOrcado` da API) — o `valorOrcadoAtualizado` traz reestimativas (RPPS
Fundo Financeiro 14,8→52,3mi ×2 = +75,0mi) e quebra a identidade. Resíduo
conhecido: intra PREVISTA assimétrica (cat-7/8 R 103,67mi × mod-91 D
105,64mi, Δ 1,97mi — classificação, não investigado).

## Fase 3 (DCL/RGF consolidados) — BACKLOG (não iniciada)
`ConsolidacaoService.{disponibilidade,dcl}(municipioId, ano)`: somar DividaItem
+ DisponibilidadeFonteService das entidades, com **exclusão do RPPS na dedução**
(regra MDF — a disponibilidade do RPPS não entra). RPPS identificado por
nome/tipo (ADM_INDIRETA + /previdência/i; sem TipoEntidade dedicado). CUIDADO:
o repasse RPPS eliminado na despesa 91 é o mesmo da exclusão RPPS na DCL — não
descontar 2×. Conferir vs oficial −539,62 e viva −433,0. É o backlog (3) da SYNC.

## Fases futuras (histórico)
- RCL consolidada real quando a RECEITA das entidades entrar (a intra cat 7 do
  RPPS aparece; o helper já cobre).
- DCL/RGF consolidados por ente (`dcl.ts`/`disponibilidade-fonte.ts` hoje por
  entidade) — encaixa no refino MDF da SYNC; CUIDADO: o repasse ao RPPS
  eliminado na despesa é o mesmo que interage com a exclusão do RPPS na
  dedução da DCL — não descontar 2×.
- MSC (Matriz de Saldos Contábeis) com atributo intra-OFSS por conta-corrente =
  formato STN/Siconfi, alvo de médio prazo (fundação da consolidação oficial).
