---
name: mdf-rgf-tesouro-referencia
description: MDF 9ª ed. Parte IV (RGF) no site do Tesouro — mapa das seções/anexos com IDs de URL, prazos de publicação e o que o Gênesis já cobre × falta
metadata:
  type: reference
---

# MDF 9ª edição — Parte IV: Relatório de Gestão Fiscal (Tesouro Nacional)

Material de estudo indicado pelo Marco (2026-07-06). Base para formalizar os
anexos do RGF no Gênesis — hoje temos o Anexo 5 pronto e o [[lrf-despesa-epico-plano]]
(Guardião) cobrindo os indicadores, mas NÃO os demonstrativos no formato oficial.

## Como navegar o manual
URL base: `https://conteudo.tesouro.gov.br/manuais/index.php?option=com_content&view=article&id=<ID>&Itemid=675`
(troque `view=article` por `view=category` para listar uma seção). Raiz do MDF 9ª ed: id=560.
Parte IV (RGF): categoria id=676.

## Mapa da Parte IV (ids de URL)
- 04.00.01 Introdução (cat 677): Introdução id=3088 · **Conteúdo do Relatório id=1344** (link do Marco) · Objetivo id=1345
- 04.00.02 Abrangência: Entes id=1346 · Consórcios id=1347
- 04.00.03 Limites: id=1342
- 04.00.04 Penalidades: Não divulgação id=1348 · Descumprimento Pessoal/DCL id=1349
- 04.00.05 Prazos: id=3089 · Poder Executivo id=1351
- **Anexo 1 – Despesa com Pessoal** (cat 681)
- **Anexo 2 – Dívida Consolidada Líquida** (cat 687)
- **Anexo 3 – Garantias e Contragarantias** (cat 693)
- **Anexo 4 – Operações de Crédito** (cat 698)
- **Anexo 5 – Disponibilidade de Caixa e Restos a Pagar** (cat 704)
- **Anexo 6 – Demonstrativo Simplificado do RGF** (cat 710)
- 04.07 RGF Consolidado (cat 714)

## Regras que importam ao produto
- RGF é **quadrimestral** (jan–abr, mai–ago, set–dez), publicação **até 30 dias** após o fim do quadrimestre.
- Municípios **< 50 mil hab.** podem optar por **semestral** (até 30/jul e 30/jan). Se estourar limite de Pessoal/DCL, voltam à verificação quadrimestral. (Maringá ~400 mil hab. → quadrimestral.)
- Conteúdo mínimo: comparativos com limites de **Pessoal, DCL, Garantias e Operações de Crédito**; no **último quadrimestre** entra também **Disponibilidade de Caixa e RP** (nosso Anexo 5).

## Gênesis: coberto × falta (2026-07-06, fim do dia — ÉPICO EXECUTADO)
- ✅ **Anexos 1–6 TODOS vivos** (épico de 6 PRs #202–#208 no mesmo dia): 1 (DTP executada
  por quadrimestre), 2 (DCL viva do cadastro − caixa/RP, LDO como comparativo), 3
  (Garantias 22%), 4 (Op. Crédito 16% + ARO 7%), 5 (já existia), 6 (Simplificado,
  compõe sem recalcular; bloco disponibilidade só q=3). `quadrimestre.ts` dá períodos
  e prazos; rotas `/orcamento/relatorios/rgf/anexoN?q=1|2|3`; cadastros em
  `/app/orcamento/rgf/cadastros`. Contrato memoriais-lrf **1.9.0**; Guardião 9 indicadores.
- ❌ Falta do capítulo: RGF **consolidado** (04.07, Câmara+RPPS), alerta de calendário de
  publicação, composição da DC real por categoria (hoje item único DEMAIS 544,32mi), e
  DCL fechar com TCE (−539,62mi) — depende dos saldos bancários reais (backlog nº 1).
