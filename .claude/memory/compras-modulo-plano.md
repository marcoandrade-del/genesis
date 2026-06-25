---
name: compras-modulo-plano
description: Módulo Compras Públicas (Lei 14.133) — plano de 3 PRs por fase e estado atual
metadata: 
  node_type: memory
  type: project
  originSessionId: 89029b9d-4e10-4cea-b5c8-b2f2d4333e35
---

Módulo de **Compras Públicas Municipais** (Lei 14.133/2021 + Lei 4.320/1964), fluxo ponta-a-ponta. Spec original em `Compras Públicas Municipais.txt` (raiz, não commitado). Entrega **incremental em 3 PRs por fase**:

- **PR-1 — Planejamento (interna)** ✅ feito na branch `feat/compras-planejamento` (a partir de `master`). Modelos: `ItemCatalogo` (catálogo global CATMAT/CATSER, único por tipo+código), `PlanoContratacaoAnual`+`ItemPca`, `DocumentoDemanda`(DOD)+`ItemDemanda`, `TermoReferencia`(TR 1:1 com DOD)+`ItemTermoReferencia`, `ReservaDotacao`. Alterou `DotacaoDespesa`: `valorReservado`/`valorEmpenhado` (saldo materializado, default 0). Slice vertical completo: 5 services + camada admin (4 telas: itens-catalogo, planos-contratacao, documentos-demanda, reservas-dotacao) + views EJS + 123 testes (75 service + 48 admin). Suíte total 2109 ✓. Editor de itens nas telas usa linhas dinâmicas serializadas em campo `itensJson` (services usam replace-all); JS construído via DOM API (sem innerHTML, por segurança). Commitado (`5ef887f`) e em revisão no **PR #35** (base `master`).
- **PR-2 — Seleção do fornecedor (externa)** ✅ feito na branch `feat/compras-selecao` (empilhada sobre `feat/compras-planejamento`). Modelos: `Fornecedor` (global, PJ/PF, CNPJ/CPF únicos), `Processo`+`Lote`+`ItemProcesso` (julgamento **por item E por lote** — Marco sobrescreveu), `Contrato`+`ItemContrato`, `AtaRegistroPreco`+`ItemAtaRegistroPreco` (Contrato e ARP **separados** — Marco sobrescreveu). ItemContrato/ItemAta têm quantidadeEmpenhada/Utilizada (saldo p/ PR-3). REGRA 3 (teto: adjudicado ≤ estimado) no julgamento. Slice completo: 4 services + 4 telas admin + 73 testes (42 service + 31 admin). Suíte total 2182 ✓. Commitado (`aa0676c`) e em revisão no **PR #36** (base `feat/compras-planejamento`, pois empilhado no #35 — retargetar para `master` quando o #35 entrar).
- **PR-3 — Execução financeira (3 estágios)** ✅ feito na branch `feat/compras-execucao` (empilhada sobre `feat/compras-selecao`). Granularidade **por valor** (Marco aceitou recomendação): `Empenho` (tipo/status, valorLiquidado; reservaDotacaoId; contrato/ata informativo), `Liquidacao` (valorPago), `OrdemPagamento` (contaBancaria texto). REGRA 2 (empenho baixa reserva→BAIXADA + dotação reservado→empenhado; empenho direto checa saldo disponível), REGRA 4 (Σ liquidações ≤ empenho), REGRA 5 (liquidação exige empenho ATIVO; OP exige liquidação ATIVA). Slice completo: 3 services + 3 telas admin (empenhos, liquidacoes, ordens-pagamento) + 41 testes. **Módulo de Compras COMPLETO** — fluxo ponta a ponta PCA→DOD→TR→Reserva→Processo→Contrato/ARP→Empenho→Liquidação→Pagamento. Suíte total 2223 ✓. Commitado (`59a4cff`), **PR #38** (base `feat/compras-selecao`).

**PRs empilhados — ordem de merge: #35 → #36 → #38** (cada um retargetar para `master` conforme o anterior entrar). Todos abertos em revisão.

Decisões de modelagem (confirmadas pelo Marco): saldo **materializado** em DotacaoDespesa (não razão de movimentos); Fornecedor **global** CNPJ-único; itens via **catálogo central CATMAT/CATSER** (Marco sobrescreveu minha sugestão de texto livre).

REGRA 1 (saldo) implementada em `ReservasDotacaoService`: reserva não pode exceder `saldoDisponivel = autorizado − reservado − empenhado`; incrementa `valorReservado` na transação; `cancelar()` estorna. Erro de saldo = `ENTIDADE_NAO_PROCESSAVEL` (422). Ver [[contabil-regras-orcamentario]].
