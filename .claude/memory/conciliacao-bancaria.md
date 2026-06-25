---
name: conciliacao-bancaria
description: Conciliação bancária — casa créditos do extrato com arrecadações por conta (PR
metadata: 
  node_type: memory
  type: project
  originSessionId: bebb6b7f-4392-45b6-8ab4-efdcefb3872a
---

Conciliação bancária (PR #94, branch `feat/conciliacao-bancaria`). Por **conta bancária**,
casa os **créditos do extrato** com as **arrecadações** já registradas naquela conta — 1:1,
**audita, não cria arrecadação**. Tela `/app/orcamento/conciliacao` (item no menu do /app).

- `MovimentoBancario` (`movimentos_bancarios`): contaBancariaId, data, valor, `sentido`
  (=TipoLancamento, CREDITO=entrada), historico, documento, `origemImport`
  (MANUAL/CSV/OFX/CNAB), loteImport, `arrecadacaoId @unique` nullable (1:1 com Arrecadacao).
- `extrato-parsers.ts`: `parseCSV` (`data;valor;historico`, BR/US, `;` ou `,`),
  `parseOFX` (blocos `<STMTTRN>` do OFX 1.x SGML). `parseExtrato('CNAB',…)` lança erro (fase 2).
- `ConciliacaoBancariaService`: registrarManual, importar (lote=randomUUID), painel
  (conciliados / extratoPendente / arrecadacoesPendentes / totais), `sugerir` (auto-match
  por **valor igual + |data|≤3 dias**, só 1:1 sem ambiguidade), conciliar/desconciliar
  (valida mesma conta + estado), excluirMovimento (só se não conciliado).
- Só casa arrecadações **com `contaBancariaId`** (#91); as sem conta não entram no painel.

**Upload + CNAB (PR #96, feito):** o navegador lê o arquivo (FileReader) p/ a textarea e
autodetecta o formato pela extensão — sem `@fastify/multipart`. Parser **CNAB 240** retorno de
cobrança (`parseCNAB240`: casa Segmento T documento + U valor pago/data crédito). **Falta:** CNAB 400.
Liga-se à integração da receita ([[integracao-receita-eventos]]): a arrecadação que casa
já gerou os lançamentos E100–E500.
