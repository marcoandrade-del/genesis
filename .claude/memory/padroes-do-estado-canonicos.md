---
name: padroes-do-estado-canonicos
description: "Regra estrutural do Gênesis — todo estado tem tabelas-padrão canônicas (eventos, planos de contas/receita/despesa) no modelo; não fugir delas"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 50efd566-11fe-4e56-8e0b-efaf7198ed26
---

# Padrões do estado são canônicos — não fugir deles (diretriz do Marco, 2026-07-11)

**Regra:** Todo ESTADO tem um conjunto de tabelas-padrão que definem a contabilidade dele, e que vivem no **modelo contábil** (por estado):
- **Tabela de eventos padrão** (`EventoContabil`/`EventoLancamento` — as regras D/C da integração orçamentário↔contábil);
- **Plano de contas padrão** (PCASP estendido do estado);
- **Plano de receitas padrão** (naturezas de receita);
- **Plano de despesa padrão** (naturezas de despesa).

**A gente NÃO pode fugir disso — senão quebra toda a estrutura do projeto.**

**Why:** o Gênesis inteiro é *modelo-driven* (por estado): entidade → modelo do seu estado → tabelas-padrão. Os padrões são a fonte da verdade (STN/TCE publicam; ex.: PARANÁ, arquivos em `data/`: `tabela_de_eventos.pdf`, PCASP receita/despesa/estendido, `tabela_natureza_despesa_tcepr_2026.csv`). Inventar de/para, hardcodar contas ou criar mapeamento paralelo faz a entidade divergir do modelo do estado e arrebenta consistência, emissão (MSC/RREO/RGF) e o rollup.

**How to apply:**
- Qualquer coisa contábil (de/para natureza→VPA/VPD, eventos, contas, backfill do motor) **dirige pela tabela-padrão do modelo** — nunca por mapa hardcodado nem por chute de natureza.
- Completar um de/para incompleto = **carregar do padrão oficial do estado**, não modelar à mão. Se o padrão não traz a coluna (ex.: NR→VPA), essa correlação também é publicada/derivável do padrão — buscar a fonte, não inventar.
- O motor (`motor-eventos-receita/despesa.ts`) já faz certo: lê `EventoContabil` do modelo. Manter esse padrão em tudo (validadores, backfill, emissores).
- Ao construir para uma entidade nova, herdar o modelo do estado; desdobramentos locais da entidade ficam ACIMA do modelo, sem alterar o padrão.

Relaciona: [[icf-ranking-siconfi]] (Dim IV backfill dirige pela tabela de eventos do modelo), [[contabil-tres-planos-de-contas]], [[contabil-regras-orcamentario]], [[integracao-receita-eventos]], [[contabil-rcl-lrf-plano]] (motor parametrizável por Estado: STN default + deltas).
