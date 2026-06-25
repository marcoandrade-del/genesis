---
name: despesa-eventos-contabeis-proposta
description: Proposta de de/para dos eventos contábeis da DESPESA (E600/E700/E800) — empenho/liquidação/pagamento → partida dobrada; espelha a receita. Frente sendo construída por OUTRA sessão (feat/despesa-realizacao-ledger).
metadata: 
  node_type: memory
  type: project
  originSessionId: bebb6b7f-4392-45b6-8ab4-efdcefb3872a
---

# Integração contábil da DESPESA — proposta de eventos (E600/E700/E800)

Espelha a receita ([[integracao-receita-eventos]]): cada estágio da execução da
despesa dispara **partida dobrada automática** via Tabela de Eventos. Hoje
empenho/liquidação/pagamento só atualizam saldo orçamentário materializado
(`DotacaoDespesa`/`Empenho`/`Liquidacao`), **não geram `Lancamento`**.

⚠️ **Quem está fazendo:** uma OUTRA sessão está na branch **`feat/despesa-realizacao-ledger`**
(2026-06-22) com mudanças não-commitadas em `src/services/{empenhos,liquidacoes,ordens-pagamento}.ts`,
`src/admin/{empenhos,liquidacoes,ordens-pagamento}.ts` e views de empenhos/liquidações.
Há também branch `feat/app-desdobrar-despesa-dotacao`. Esta memória é **referência** p/
essa sessão — Marco mandou deixar a despesa pra ela ("deixe tudo para a outra seção resolver").

## ⚠️ Feedback do Marco sobre a proposta (2026-06-22) — IMPORTANTE
> "a funcional programática tem que ser completa, todos os níveis. me parece que está só a natureza da despesa"

Ou seja: a parametrização/conta-corrente da despesa **NÃO pode ser chaveada só pela
natureza de despesa**. Tem que cobrir a **classificação funcional-programática completa**
(função, subfunção, programa, ação/projeto-atividade-operação) + UO + natureza + fonte —
todos os níveis. O `ParametroReceita` casa só por prefixo de natureza; a despesa precisa
de uma dimensão mais rica (a conta-corrente do orçamentário/DDR deve carregar dotação
completa, não só natureza). **Confirmar o desenho disso com o Marco antes de seedar.**

## Estrutura proposta (contas PCASP confirmadas como folhas no plano — TCE-PR/RO)

Todas as contas abaixo existem e `admiteMovimento=true` no modelo (`contas`).

### E600 — Empenho (orçamentário + controle DDR)
| Aspecto | Débito | Crédito | conta-corrente |
|---|---|---|---|
| Orçamentário | `6.2.2.1.1.00...` Crédito Disponível | `6.2.2.1.3.01...` Empenhado a Liquidar | dotação completa |
| DDR (cl.8) | `8.2.1.1.1.01...` Recursos Disponíveis | `8.2.1.1.2.01...` Compr. p/ Empenho – a Liquidar | fonte |

### E700 — Liquidação (orçamentário + DDR + PATRIMONIAL = fato gerador da VPD)
| Aspecto | Débito | Crédito | cc |
|---|---|---|---|
| Orçamentário | `6.2.2.1.3.01...` Empenhado a Liquidar | `6.2.2.1.3.03...` Liquidado a Pagar | dotação |
| DDR | `8.2.1.1.2.01...` Compr. Empenho a Liquidar | `8.2.1.1.3.01...` Compr. p/ Liquidação | fonte |
| **Patrimonial** | **VPD (classe 3, por natureza/de-para)** | **Passivo a pagar (`2.1.x`, por natureza/de-para)** | natureza |

### E800 — Pagamento (orçamentário + DDR + FINANCEIRO)
| Aspecto | Débito | Crédito | cc |
|---|---|---|---|
| Orçamentário | `6.2.2.1.3.03...` Liquidado a Pagar | `6.2.2.1.3.04...` Pago | dotação |
| DDR | `8.2.1.1.3.01...` Compr. Liquidação | `8.2.1.1.4.01...` Utilizada c/ Exec. Orçam. | fonte |
| **Financeiro** | **Passivo a pagar (`2.1.x`)** | **Caixa/Banco (`1.1.1.x` da ContaBancaria)** | fonte |

Códigos completos (12 segmentos) das folhas-chave:
`6.2.2.1.1.00.00.00.00.00.00.00`, `6.2.2.1.3.01/.03/.04`, `8.2.1.1.1.01`,
`8.2.1.1.2.01` (e `.02` em liquidação), `8.2.1.1.3.01`, `8.2.1.1.4.01`,
caixa `1.1.1.1.1.xx` (vem da ContaBancaria, como #91 na receita).

## de/para `ParametroDespesa` (a criar — espelha `ParametroReceita`)
Modelo novo: `modeloContabilId`, chave de classificação (ver feedback: **completa**, não só natureza),
`contaVpdCodigo` (classe 3), `contaPassivoCodigo` (`2.1.x`); match por prefixo mais longo.
Default MCASP sugerido por grupo de natureza: `3.1.90` → VPD pessoal + `2.1.1` pessoal a pagar;
`3.3.90` → VPD uso de bens/serviços + `2.1.3` fornecedores. **Capital `4.4.90`** NÃO é VPD:
incorpora ativo (`D 1.2.3.x` bens imobilizados / `C` passivo) — tratar como ramo à parte.
Retenções (INSS/ISS na fonte no pagamento) = refinamento posterior.

## Reuso do motor da receita
`MotorEventosReceita` ([[integracao-receita-eventos]]) é o template: helper `resolverContas`
(código→id, valida folha), conta-corrente como DIMENSÃO no `LancamentoItem`
(`naturezaReceitaCodigo`/`fonteCodigo` — a despesa precisaria de campos análogos OU reuso),
estorno inverte D↔C, `saldoDaConta` p/ controles de baixa parcial. Campos de rastreabilidade
em `Lancamento` já existem: `origemTipo`/`origemId`/`eventoCodigo`. Criar `OrigemLancamento +=
EMPENHO/LIQUIDACAO/PAGAMENTO` e `motor-eventos-despesa.ts`.

## Pontos a confirmar com o Marco (accounting — ele define)
1. Desenho da conta-corrente "funcional-programática completa" (o feedback acima).
2. Recorte cut 1 (só custeio 3.x vs incluir capital 4.4.x→ativo) — sem preferência declarada.
3. Tabela de/para exata vs default que a sessão seed — sem preferência declarada.
