---
name: icf-e100-sinal-proposta
description: "Proposta/handoff p/ a frente emissor/modelo — o E100 (receita orçamentária) do PARANÁ debita 6.2.1.2 (receita realizada), mas o STN a define CREDORA/creditada; decide o check ORCAMENTARIA_INVERTIDA da Dim I"
metadata:
  node_type: memory
  type: project
  originSessionId: eabf10dd
---

# Proposta: sinal do E100 (receita realizada 6.2.1.2) — Dim I `ORCAMENTARIA_INVERTIDA`

**Handoff da sessão eabf10dd (2026-07-11) para a frente do EMISSOR/MODELO.** Descoberto ao atacar as ✗ estruturais do validador Dim I sobre a execução real de Maringá (pós-backfill #236/#243). NÃO toquei nada canônico — decisão do dono do modelo/emissor.

## O achado (preciso)
- O check `MSC_DIM1_ORCAMENTARIA_INVERTIDA` (D1_00038) acusa **1673 linhas** — mas todas são de **UMA única conta**: `6.2.1.2.0…` (RECEITA REALIZADA), quebrada por natureza da receita. Saldo devedor R$ 1.687.151.162,07. Nenhuma outra conta 5-6 está invertida (a despesa 6.2.2.x está OK).
- **Tabela de eventos do PARANÁ**, `EventoContabil` gatilho `ARRECADACAO` cód **100**: `D 6.2.1.2.0… / C 6.2.1.1.0…`. **Nada credita 6.2.1.2** → ela é estruturalmente DEVEDORA no razão.
- **Modelo (`contas.naturezaSaldo`)**: `6.2.1.2` = **CREDORA** (6.2.1.1 = MISTA). Débito estrutural × natureza credora = "invertida" por construção.
- **STN/PCASP** ([PDF oficial do Tesouro](https://cdn.tesouro.gov.br/sistemas-internos/apex/producao/sistemas/thot/arquivos/publicacoes/33686_1104895/anexos/8994_356090/PCASP.pdf?v=8328)): 6.2.1.2 é CREDORA e **creditada na arrecadação** (D 6.2.1.1 a realizar / C 6.2.1.2 realizada). Ou seja, a tabela de eventos do PARANÁ usa o sinal **oposto** ao STN.
- ⚠️ A abertura **não** é dirigida por `EventoContabil` (não existe gatilho ABERTURA) — o sinal de 6.2.1.1/6.2.1.2 na abertura vive no **serviço de abertura (PR #110)**. Qualquer correção de convenção precisa alinhar OS DOIS lugares (abertura + E100).

## Passo 1 (obrigatório antes de mudar): confirmar a fonte oficial
A natureza no modelo (CREDORA) veio de algum lugar. **Confira o PCASP OFICIAL do TCE-PR** (arquivos em `data/`, ex.: `tabela_de_eventos.pdf`, PCASP estendido) para a natureza de 6.2.1.2 **e** como o TCE-PR emite a MSC ao Siconfi (débito ou crédito). Isso decide o caminho — não mudar canônico na minha inferência.

## Opções
- **(A) Corrigir a natureza no modelo: `6.2.1.2` CREDORA → DEVEDORA.** Barato, **sem regenerar razão** (nenhum valor muda; só o campo natureza). O check passa e o balancete fica consistente com a convenção "debita realizada" que o PARANÁ já usa. **Válida SE** o TCE-PR/Siconfi aceita a realizada como devedora. Risco: se o Siconfi exige crédito, isto só silencia o check sem conformar a MSC.
- **(B) Corrigir a tabela de eventos p/ o STN:** E100 → `D 6.2.1.1 / C 6.2.1.2` + alinhar o serviço de abertura (previsão credita a-realizar). **Correto na origem**, mas **inverte o sinal da receita realizada no razão** → regenera o razão da receita e **impacta todos os consumidores** de 6.2.1.x (RREO receita, `saldo-orcamentario`, `arrecadacoes.resumo`, MSC). Blast radius grande.
- **(C) Sinal só na projeção da MSC (emissor):** o razão/RREO/RGF ficam na convenção PARANÁ (intacta e reconciliada); o **emissor da MSC** projeta 6.2.1.2 no sinal STN ao emitir p/ Siconfi. Localiza o fix no alvo (Siconfi), sem churn no razão. Precisa da regra de quais contas espelhar.

## Recomendação
Passo 1 primeiro. Se o TCE-PR usa convenção "debita realizada" (comum nos sistemas de gestão do PR) ⇒ **(A)** (corrigir a natureza do modelo, trivial). Se o Siconfi exige crédito ⇒ **(C)** (emissor espelha o sinal) para não regenerar razão/RREO/RGF. **(B)** só se quiser o razão inteiro no padrão STN — mais caro, coordenar por causa do blast radius.

## Regeneração (só se (B))
Reaproveitar `scripts/backfill_contabil_execucao.ts` (idempotente por origemTipo+origemId): apagar os lançamentos de receita `BACKFILL_EXEC` da Prefeitura de Maringá e reaplicar com o E100 corrigido; revalidar reconciliação (receita realizada segue 1.687.151.162,07 em magnitude) e RREO/RGF.

Relaciona: [[icf-ranking-siconfi]] (Dim I/IV), [[padroes-do-estado-canonicos]] (dirige pelo padrão do estado — buscar a fonte oficial, não chutar), [[coordenacao-sessoes]].
