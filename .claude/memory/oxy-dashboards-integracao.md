---
name: oxy-dashboards-integracao
description: "Projeto Oxy Dashboards (BI+IA sobre dados públicos, do Marco) e a estratégia de integração com o Gênesis — Gênesis = sistema de registro; Oxy = camada de BI/IA/LRF. Specs LRF em 'Specs LRF e Memoriais de Cálculo.txt'."
metadata:
  node_type: memory
  type: project
  originSessionId: 54bff2d1-e062-496b-aaad-a2da27d1b21f
---

# Oxy Dashboards × Gênesis — separação de responsabilidades

Marco está construindo um **segundo projeto, Oxy Dashboards**: BI sobre dados públicos com **IA rápida + IA avançada** (insights automáticos, alertas, **persona conversacional** que "mastiga" a informação) + um **buscador de inovações** (mudanças legais/normativas) que avisa o usuário, ele autoriza a atualização, guarda histórico. Vibe: https://claude.ai/share/a585c76a-2d00-46d4-b0c9-51fda3702884 (link de share — não navegável por mim).

## Specs LRF (arquivo `Specs LRF e Memoriais de Cálculo.txt`, raiz)
Memoriais de cálculo da LRF são definidos por lei (STN / Min. Planejamento), mas **cada TCE faz o seu memorial** para fiscalizar, e há **mudanças/inovações frequentes**. Memoriais (LRF, balancete, balanços) viram ferramenta de gestão quando dentro de um BI com IA.

## Recomendação de arquitetura (minha, endossada como o desenho correto)
- **Gênesis = sistema de REGISTRO** (transacional/ERP municipal): orçamento, execução (empenho→liquidação→pagamento), contabilidade, arrecadação. É a **fonte da verdade**.
- **Oxy = camada de BI/IA/LRF**: consome os dados do Gênesis e roda os **memoriais de cálculo** (RREO/RGF, limites **MDE 25% / Saúde 15% / Fundeb / Pessoal**) + insights/alertas/persona. **NÃO trazer BI/IA para dentro do Gênesis.**
- Os memoriais são **cálculos SOBRE** os dados do Gênesis → pertencem ao Oxy. O dever do Gênesis é entregar os dados na **granularidade certa** (função/subfunção/programa/ação/natureza+**sub-elemento**/fonte) — que é justamente o que a realização da despesa (#109) construiu. **A realização da despesa é a fundação dos memoriais.**

## Como os dois "compartilham" (não é cópia de código — é CONTRATO de dados)
1. **MSC (Matriz de Saldos Contábeis) → Siconfi** = o formato **nacional padrão** de intercâmbio. Gênesis produz a MSC; Oxy consome. Caminho de integração mais natural.
2. **Views `rel_*`** (sandbox read-only que o Gênesis já tem p/ relatórios) + um data API read-only para consultas mais ricas.
3. **Memoriais (fórmulas, por TCE)** = artefato/spec **compartilhado** que os dois referenciam. O **buscador de inovações** é capacidade transversal (pode ser serviço compartilhado), mas o consumo (avisar/autorizar/histórico) é BI → Oxy.

## Implicação p/ o roadmap do Gênesis
O que mais habilita LRF/Oxy é **fechar a ponte execução→contabilidade** (o Motor de Eventos da Despesa, PR #114, em andamento) **+ a MSC**. Isso completa o lado "sistema de registro" e dá ao Oxy o dado completo e correto. Ver [[spec-realizacao-despesa-2026-06-22]], [[integracao-receita-eventos]].
