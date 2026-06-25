---
name: abertura-exercicio-pcasp
description: Abertura do exercício conforme PCASP (PR
metadata: 
  node_type: memory
  type: project
  originSessionId: bebb6b7f-4392-45b6-8ab4-efdcefb3872a
---

# Abertura do exercício (PCASP) — contabilização

Cadeia que o Marco definiu (2026-06-22): **planejamento orçamentário pronto/aprovado/publicado
→ abertura do exercício (PCASP) → acumulado diário dos planos na execução**. Decidiu começar
pela ABERTURA (semeia o acumulado) e que o acumulado diário será **materializado** (tabela
saldo conta×dia) — essa 2ª camada ainda NÃO foi feita.

## PR #110 (`feat/abertura-exercicio-pcasp`) — a abertura contábil
Antes, `AberturaExercicioService.abrir()` só **copiava a estrutura** dos planos. Agora há
`AberturaContabilService` (`contabilizar`/`estornar`/`status`) que CONTABILIZA a abertura a
partir da LOA **APROVADA**, em transação:

- **Parte A — orçamentário** (1 lançamento de previsão + 1 de fixação, itens com cc):
  - Previsão da receita: **D `6.2.1.1.0`** (a realizar) / **C `5.2.1.1.1`** (previsão inicial), cc natureza+fonte.
  - Fixação da despesa: **D `5.2.2.1.1.01`** (crédito inicial) / **C `6.2.2.1.1`** (crédito disponível), cc fonte.
  - **Direção derivada do motor da execução** (E100 credita "a realizar"; E600 debita "disponível")
    p/ abertura + execução **zerarem** no fim do exercício. Corrige o gap: hoje a arrecadação
    creditava "a realizar" a partir do ZERO (orçamentário nunca era semeado).
- **Parte B — transporte patrimonial**: `SaldoInicialAno[ano] = |saldo final[ano−1]|` só p/ o
  balanço (códigos `1.`/`2.`); resultado (3 VPD/4 VPA) começa zerado. **Greenfield** (sem ano
  anterior) → nada. ⚠️ `SaldoInicialAno.valor` é **MAGNITUDE** (≥0); o sinal vem da natureza no
  `SaldoContabilService` (por isso `.abs()`).
- **Ciclo**: exige LOA APROVADA; ao contabilizar, **APROVADO→EM_EXECUCAO**. Idempotente (status
  EM_EXECUCAO bloqueia) e reversível (`estornar`, bloqueado se já há execução não-abertura no ano).
- `OrigemLancamento += ABERTURA`; reusa `LancamentosService.criar` (D=C, ResumoMensalConta) +
  `SaldoContabilService`. UI no `/app` orçamento: card status + botões Contabilizar/Estornar (gate escrita).

Status do orçamento é gerido no **/admin** (`alterarStatus` RASCUNHO→APROVADO→EM_EXECUCAO);
o /app só mostrava read-only — agora a contabilização da abertura é o caminho do operador p/ EM_EXECUCAO.

## Validação ao vivo (Maringá 2026, LOA real)
403 previsões = R$ 3,17 bi; 2.325 dotações = R$ 2,84 bi. As 4 contas de controle bateram exato.
⚠️ A entidade já tinha **7 lançamentos + 1 SaldoInicialAno** (de outra sessão/demo) → o `estornar`
do serviço seria bloqueado pela guarda de execução; testei com **limpeza cirúrgica** (excluir só
os 2 lançamentos `origemTipo=ABERTURA` + voltar status), preservando os dados alheios.

## Camada 2 — acumulado diário materializado (PR #111, EMPILHADA sobre #110)
Branch `feat/saldo-diario-acumulado` (base = `feat/abertura-exercicio-pcasp`). Modelo
**`MovimentoDiarioConta`** (entidade×conta×dia → débito/crédito) mantido na MESMA transação do
lançamento (junto do `ResumoMensalConta`) em `LancamentosService.criar/excluir`; migração
`add_movimentos_diarios_conta` + **backfill** `scripts/backfill_movimento_diario.ts` (SQL agregado,
idempotente). **`SaldoDiarioService.serie`** = saldo corrido dia a dia (lado natural, convenção do
razão). Tela `/app/contas/:id/diario` + link no razão. Escopo: **contábil** (cobre arrecadação +
abertura). Validado ao vivo: série bate EXATO com `SaldoContabilService`. Suíte **3000**.
⚠️ Quando #110 mergear, rebasear #111 no master. ⚠️ Outras sessões usam o mesmo banco dev sem o
delegate `movimentoDiarioConta` → lançamentos delas NÃO populam o diário até o merge; re-rodar o
backfill após o merge p/ recuperar.

## Camada 3b — acumulado diário da RECEITA (PR #113 MERGEADO, `9b351b6`)
Branch `feat/receita-diario-acumulado` (independente, off master, SEM schema change). A
`Arrecadacao` já é o ledger datado da receita → `ArrecadacaoDiariaService.serie` lê direto dela
(líquido/dia = arrecadação−estorno, acumulado; escopo entidade→orçamento→previsões; previsto via
aggregate). Tela `/app/orcamento/arrecadacao/diario` + link na arrecadação. Suíte **3005**.
Validado ao vivo (arrecadado/previsto batem com os materializados em PrevisaoReceita).

## Camada 3c — acumulado diário da DESPESA (PR #115 MERGEADO, `8b9189c`)
Branch `feat/despesa-diario-acumulado` (off master, SEM schema change). Espelha a receita: o
`MovimentoEmpenho` já é o ledger datado da execução da despesa (criado pelo motor #114) →
`DespesaDiariaService.serie(entidadeId, ano)` lê direto dele (`groupBy` data+tipo, escopo
`empenho→dotacaoDespesa→orcamentoId`) e devolve **3 séries líquidas/dia** (empenhado/liquidado/pago
= movimento − estorno por fase) acumuladas, vs o **fixado** (Σ `DotacaoDespesa.valorAutorizado`).
Tela `/app/orcamento/despesa/diario` + link no saldo orçamentário. Suíte **3086**. Validado contra
o banco real (Maringá, fixado 2,84bi exato) + render HTTP ao vivo. **TRÍADE COMPLETA** (#112+#113+#115).

## Próximo (a fazer)
(Opcional) estados de orçamento "enviado ao Legislativo/publicado" além do APROVADO. ⚠️ Re-rodar
`scripts/backfill_movimento_diario.ts` depois que as outras sessões puxarem o master (lançamentos
delas não populam o `MovimentoDiarioConta`).
