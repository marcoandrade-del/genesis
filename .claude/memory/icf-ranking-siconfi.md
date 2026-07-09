---
name: icf-ranking-siconfi
description: "Ranking Siconfi / ICF (nota A–E) como alvo externo do Gênesis; metodologia das 185 verificações e gap-list para um \"medidor de ICF\" (keystone = emitir MSC)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 50efd566-11fe-4e56-8e0b-efaf7198ed26
---

# ICF / Ranking Siconfi como alvo do Gênesis

Disparado pela **Portaria STN/MF nº 1.833, de 24/06/2026** (DOU) — só DIVULGA o Ranking + o "IV Prêmio Qualidade da Informação Contábil e Fiscal" (dados de 2025); NÃO é norma técnica (base: Portaria STN/MF 807/2023). Ranking em https://ranking-municipios.tesouro.gov.br/. Maringá cai na categoria "municípios >100 mil hab.".

## Metodologia do ICF (Indicador da Qualidade da Informação Contábil e Fiscal)
- Nota = **% de acertos** em verificações automáticas sobre o que o ente ENVIOU ao Siconfi. **A** = >95%, **E** = <65% (5 faixas). Selo = nota A ("Aicf").
- Fontes: **DCA, RREO (6ºB), RGF (3ºQ/2ºS), MSC (Matriz de Saldos, mensal + dezembro)**. Corte 2026 = 10/05/2026.
- **185 verificações ativas em 2025**, 4 dimensões: I-Gestão (39), II-Contábil (74), III-Fiscal (44), IV-Contábil×Fiscal (28). Catálogo baixado de `descricao_ranking.csv` + `verificacoes_aplicabilidade.csv`; cópia legível em scratchpad `catalogo_verificacoes_2026.md`.

## De/para com o Gênesis (gap-list)
- **Guardião** (`src/services/memorial-guardiao.ts`, 9 indicadores) NÃO é o análogo — mede LIMITES da LRF (ortogonal ao ICF).
- Motor a reaproveitar = **Selo de Consistência** (`src/services/consistencia.ts`, V1–V8): mesmo padrão `Verificacao[]→selo`, envelope versionado `memoriais-lrf`. Hoje valida consistência INTERNA do razão, não os artefatos Siconfi.
- Gênesis TEM razão completo (`saldo-contabil.ts`/`razao-contabil.ts`/VPA-VPD/abertura/PCASP) e **RREO/RGF anexos VIVOS**, mas **NÃO emite MSC nem DCA** ← isso é a chave.
- **Vantagem única**: razão único → se emitir DCA+MSC do MESMO razão que gera RREO/RGF, os **28 cruzamentos da Dim IV passam por construção** (é onde os concorrentes perdem nota A). Teto honesto de auto-checagem ≈ 164/185; as 21 de entrega/prazo/retificação dependem do ATO de transmitir (fora de escopo de registro).

## Ordem de construção proposta
1. **Emissor de MSC** (keystone; balancete PCASP × atributos poder/órgão/fonte/natureza/função/CO/atributo-F, mensal + dez).
2. Validador estrutural da MSC → 18 checks da Dim I. 3. Cruzamentos Dim IV (28). 4. Emissor de DCA → Dim II (74). 5. Envolver RREO/RGF (44) como verificações pontuadas. 6. Score/Selo ICF (nota A–E) no envelope versionado, consumível pelo Oxy.
Fases 1–3 = pré-ICF real (~46 checks "perde-ponto") sem depender de DCA.

Relaciona: [[oxy-playbook-verificacao-narrativa]] (ideia /memoriais/consistencia com selo), [[mdf-rgf-tesouro-referencia]], [[oxy-dashboards-integracao]], [[tce-pr-pit-dados-abertos]].
