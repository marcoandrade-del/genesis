---
name: integracao-receita-eventos
description: Como a arrecadação vira lançamento contábil (Tabela de Eventos / MotorEventosReceita) e a decisão conta-corrente=dimensão
metadata: 
  node_type: memory
  type: project
  originSessionId: bebb6b7f-4392-45b6-8ab4-efdcefb3872a
---

Integração orçamentário→contábil da RECEITA via Tabela de Eventos (PR #90, branch
`feat/integracao-receita-eventos`). A arrecadação dispara lançamentos automáticos
(partida dobrada) pelo `MotorEventosReceita` (`src/services/motor-eventos-receita.ts`):

- **E100** orçamentário (sempre): D `6.2.1.2` Receita Realizada / C `6.2.1.1` Receita a
  Realizar — padrão MCASP (reduz o "a realizar" que a previsão credita).
- **E200** controle DDR (sempre): D `7.2.1.1.1` ord. ou `.2` vinc. / C `8.2.1.1.1.01`.
- **E300/E400/E500** patrimonial (mesma estrutura: D Caixa / C contrapartida; `eventoPatrimonial`):
  EFETIVA→E300 (VPA cl.4); NÃO-EFETIVA op. crédito (natureza 2.1)→E400 (passivo cl.2);
  NÃO-EFETIVA alienação (2.2)→E500 (baixa de ativo cl.1); demais não-efetivas→só E100/E200.
  A conta de contrapartida vem de `ParametroReceita.contaContrapartidaCodigo` (campo `@map`
  para a coluna legada `contaVpaCodigo` — renomeado no #93, SEM migração).
- **TRIBUTÁRIA (competência, PR #95):** `ParametroReceita.indicadorReconhecimento=COMPETENCIA`
  + `contaAtivoCodigo` (créditos a receber 1.1.2.x). **Lançamento** (`LancamentoTributarioService`,
  tela `/app/orcamento/lancamento-tributario`) → **E550** D ativo / C VPA, no fato gerador
  (`motor.resolverLancamentoTributario`, origemTipo LANCAMENTO_TRIBUTARIO). **Arrecadação** do
  lançado → o motor troca o E300 por **E560** D Caixa / C baixa do ativo (sem VPA nova). Cut 1 =
  só PRINCIPAL; **dívida ativa + multas/juros = fase 2** (DA reclassifica p/ `1.2.1.1.1.04.x`).
- **DÍVIDA ATIVA + multas/juros (PR #97):** `LancamentoTributario.tipo` (LANCAMENTO|INSCRICAO_DIVIDA_ATIVA);
  inscrição → **E570** (D `1.2.1.x` Dívida Ativa / C baixa do circulante, `motor.resolverInscricaoDividaAtiva`);
  arrecadação da DA (natureza `…0.3`) reusa **E560** (ativo = conta de DA); multas/juros (`…0.2`) = efetiva (E300).
  `ParametroReceita.contaDividaAtivaCodigo`.
- **BAIXA PARCIAL CONTROLADA (PR #98):** `motor.saldoDaConta` + `validarBaixaArrecadacao`/
  `validarInscricaoDividaAtiva` — arrecadação/inscrição de competência não excedem o saldo do ativo
  (crédito a receber). Naturezas de caixa não têm controle. Saldo no nível da CONTA (específica por imposto+estágio).
- **ÉPICO RECEITA COMPLETO:** #90 base · #91 caixa pela conta bancária · #92 trilha · #93 não-efetiva ·
  #94 conciliação · #95 tributária · #96 conciliação upload/CNAB · #97 dívida ativa/multas · #98 saldo controlado.

**Decisão-chave (não óbvia):** a "conta corrente" (os X/Y das máscaras dos eventos) é uma
**DIMENSÃO** carregada no `LancamentoItem` (`naturezaReceitaCodigo`/`fonteCodigo`), **não**
um código de conta concatenado. Motivo empírico: no plano real, `6.2.1.1/6.2.1.2` e o DDR
(`7.2.1.1.x`/`8.2.1.1.1.01`) são **folhas** — não há subárvore por natureza/fonte. A conta
resolve p/ a folha fixa; natureza/fonte viajam como sub-razão (igual SIAFEM). Casa com o
"saldo por fonte com rollup" — ver [[contabil-regras-orcamentario]].

**De/para NR→VPA** vive na tabela `ParametroReceita` (modelo, naturezaCodigo, tipoMutacao,
contaVpaCodigo); o motor casa por **prefixo mais longo** (configura num nível, folhas herdam).
Seed: `scripts/seed_parametros_receita.ts`. **Rastreabilidade mão-dupla:** `origem*` no
`Lancamento` (origemTipo=ARRECADACAO, origemId=Arrecadacao.id, eventoCodigo); reverse via
`ArrecadacoesService.lancamentosDoMovimento()`. Disparo é **atômico** com o movimento
(`LancamentosService.criar(dados, tx)` aceita transação existente).

**Escopo entregue:** receita NÃO TRIBUTÁRIA EFETIVA. **Caixa do E300 (PR #91, feito):** vem da
`ContaBancaria.contaContabilCodigo` (folha 1.1.1.x) da conta escolhida na arrecadação — motor
aceita `caixaCodigo`; `ArrecadacoesService` valida conta=fonte da previsão e grava
`Arrecadacao.contaBancariaId`; sem conta → default `1.1.1.1.1.30`. **Trilha visível (PR #92, feito):** tela
"Trilha contábil do movimento" (`/app/orcamento/arrecadacao/:id/lancamentos`) +
badge "Arrecadação" no razão linkando de volta (`ArrecadacoesService.trilhaDoMovimento`,
`RazaoContabilService` carrega origem*). **Falta:** E400/E500 (não-efetiva: op.
crédito/alienação → passivo/baixa de ativo); receita TRIBUTÁRIA (lançamento/dívida
ativa); conciliação bancária. Spec viva (gitignored): `data/Specs tabela de eventos.md`.
O evento `800001` importado (creditava deduções) está ERRADO e foi superseded pelo motor.
