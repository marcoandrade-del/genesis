---
name: msc-siconfi-fonte-oficial
description: "MSC OFICIAL de Maringá baixável pela API pública do Siconfi (Tesouro) — abre a abertura patrimonial 2026 conta×cc (fonte+atributo F+poder/órgão), é o GABARITO do nosso emissor e traz o de/para poder_orgao da fase 2c; armadilha: o param é id_tv, não id_tc"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 689c5fca-4b0c-4a9d-802f-cbb7328d48f3
---

# MSC oficial via Siconfi — a fonte que destrava a abertura patrimonial (letra do Marco, 2026-07-14)

## API (decifrada e VALIDADA)
Base: `https://apidatalake.tesouro.gov.br/ords/siconfi/tt` — pública, sem auth, JSON paginado (5.000/página, `offset=`).
Spec swagger: `https://apidatalake.tesouro.gov.br/docs/siconfi.yaml` (UI em `/docs/siconfi/`).

Endpoints MSC (TODOS os filtros obrigatórios):
- `/msc_patrimonial` (classes 1-4) · `/msc_orcamentaria` (5-6) · `/msc_controle` (7-8)
- Params: `id_ente` (IBGE; Maringá **4115200**) · `an_referencia` · `me_referencia` ·
  `co_tipo_matriz` (`MSCC` mensal | `MSCE` encerramento) · `classe_conta` ·
  **`id_tv`** (`beginning_balance` | `period_change` | `ending_balance`)
- ⚠️ **Armadilha que custou 1h: o param é `id_tv`, NÃO `id_tc`** — errado devolve 200 com count 0 (sem erro!).
- Linha devolvida: `conta_contabil` (PCASP 9 díg.), `poder_orgao`, `financeiro_permanente` (atributo F/P),
  `fonte_recursos` + `ano_fonte_recursos` + `complemento_fonte`, `valor`, `natureza_conta` (D/C), `entrada_msc`.

## Dataset baixado (2026-07-14): `data/abertura-2026/msc_siconfi/`
`mscc_2026-01_bb_classe{1..8}.json` = **abertura oficial de 2026** (beginning_balance jan/2026 MSCC), 19,8k linhas:
classe 1: 1.618 · 2: 1.882 · **3/4: 0 (VPD/VPA abrem zeradas — confirma nosso abertura-contabil.ts)** ·
5: 6.006 · 6: 6.006 · 7: 944 · 8: 1.393.

## Validações feitas
- **Balanço patrimonial de abertura FECHA ao centavo:** Σ(D−C) classe 1 = +14.149.618.273,82; classe 2 = −14.149.618.273,82; **Δ 0,00**.
- ⚠️ **Escopo = MUNICÍPIO CONSOLIDADO** (3 `poder_orgao`: 10131 executivo, 10132, 20231 legislativo).
  Caixa 1.1.1.* da abertura: 10131 = 807.175.782,37 · 10132 = 2.444.378,32 · 20231 = 1.712.187,89 (Σ 811,33mi).
  **QUESTÃO ABERTA:** 10131 (807,18mi) × relação bancária da Prefeitura (775,08mi, [[saldos-abertura-2026-maringa]]) = Δ 32,1mi —
  provavelmente fundos municipais dentro do executivo consolidado que não estão na "relação de contas da Prefeitura".
  Resolver antes do import (nosso dev modela a PREFEITURA; importar o consolidado inteiro superestima).

## O que isto destrava
1. ✅ **EXECUTADO (2026-07-14, PR #252): abertura patrimonial importada** — tabela nova `SaldoInicialCc` (detalhe conta×fonte; agregado segue em `SaldoInicialAno`), emissor lê o detalhe com precedência, `scripts/importar_abertura_msc_siconfi.ts` (classes 1-2 por poder_orgao→entidade; sintética→filho .99). **Recorte DECIDIDO pela sonda: 10132 = Maringá Previdência (RPPS 1,33bi em 1.1.4), 20231 = Câmara, 10131 = executivo s/ RPPS → Prefeitura** (inclui as 4 autarquias; Δ caixa +32,1mi documentado — purificar quando houver balancete por UG). Resultado: Prefeitura CLASSES_COMPLETAS ✓ + ATRIBUTO_F ✓; Previdência/Câmara com 1ª MSC (13/14; falta a abertura ORÇAMENTÁRIA delas p/ classes 5-8).
2. ✅ **GABARITO CONSTRUÍDO (PR #254, `scripts/gabarito_msc_siconfi.ts`):** nossa MSC × oficial (`ending_balance`; Maringá tem **meses 1-5/2026 homologados**, jun ainda não; eb baixados p/ meses 1 e 5 em `data/abertura-2026/msc_siconfi/`). **1ª rodada (mês 5, Prefeitura 10131): 48 contas AO CENTAVO; classes 5-6 Δ 266,0mi (~4% — investigar: candidatos previsão-atualizada/RP); MAPA DE OBRA das lacunas: classes 3-4 nosso=0 (Dim II: VPA 3,30bi/VPD 1,32bi — **INVESTIGADA 2026-07-16, PAUSADA**: épico de curadoria FINA sem fonte pronta [não está no modelo/SIM-AM/STN; SIM-AM usa VPA genérica], de/para atual grosso não reconcilia por conta, e a VPA depende da captura da receita [SYNC Δ46,3mi]; retomar com de/para fino da Elotech + captura fechada — detalhe no board), classes 7-8 Δ 9,18bi (controles da LOA 7229/8229=previsão 3,17bi + DDR detalhada 8221101xx + 799/899 outros controles + transporte inicial da DDR), classe 1 Δ −1,95bi (créditos tributários/DA que evoluem sem nossos lançamentos), PL 2371103/2371101 com distribuição interna divergente.** É a lista priorizável do épico ICF em números.
3. **Fase 2c (poder/órgão):** os códigos oficiais que o Siconfi espera estão nas linhas (10131/10132/20231) — o de/para que faltava.
4. Cross-checks: RREO/RGF/DCA também na mesma API (`/rreo` validado: 3.657 itens Maringá).

## DRILL do Δ classes 5-6 (mês 5; feito 2026-07-14) — o "Δ 266mi" líquido são 3,88bi brutos compensados, em 5 causas:
1. **Créditos adicionais NÃO segregados no razão** (~1,25bi bruto): nossa abertura fixou o AUTORIZADO VIVO (3.381,3mi) na 5.2.2.1.1.01; o oficial segrega inicial 2.870,9mi + suplementar 4746,x… (5.2.2.1.2.01 474,6mi) + superávit (5.2.2.1.3.01 285,5mi) + anulações/cancelamentos (−104,9/−104,2mi) + valor global por fonte (5.2.2.1.3.99 −314,1mi). ✅ **FEITO por-TIPO (PR #259, 2026-07-15):** abertura fixa o `valorInicial` + `CreditoContabilService` espelha os decretos (reforço D 5.2.2.1.2.0X/C 6.2.2.1.1; anulação D 6.2.2.1.1/C 5.2.2.1.3.09). Aplicado no dev: inicial 2.842,65mi · suplementar 719,6mi · cancelamento −180,9mi · Δ0 · disponível intacto. **Por-FONTE (5.2.2.1.3.01/02/03/99) diferido** (soma-zero informacional; não modelamos a origem). ⚠️ **Gabarito MENSAL 1–5 NÃO casa: o Portal não publica a data do decreto** → 229 `CreditoAdicional` todos em 2026-07-03 → créditos concentram em JULHO (anual/≥jul corretos). Follow-up: datas reais via Diário Oficial → re-datar → re-rodar (idempotente).
2. ✅ **FEITO (PRs #261+#262, 2026-07-15): Restos a Pagar completo, 8/8 contas ao centavo no gabarito mês5.** Inscrição (bb) + execução (pc classe6) da MSC oficial; cc CRUA de despesa nova no LancamentoItem (RP não tem dotação; emissor usa fallback). 5.3.1.1=302,7 · 5.3.1.2=34,0 · 6.3.1.1=−120,2 · 6.3.1.4=−173,1 · 6.3.1.9.9=−43,0. Prova: bb+Σpc jan-mai = eb mês5 (Δ0). Scripts `importar_restos_a_pagar_msc.ts` (inscrição) + `..._execucao_msc.ts` (execução).
3. **Receita bruta × líquida (FUNDEB)**: oficial lança previsão BRUTA 3.301,1mi + dedução (5.2.1.1.2.01 FUNDEB −130,8mi); nossa abertura lançou a líquida 3.170,2mi direto. **E a realizada tem o mesmo tema**: oficial 1.603,5mi × nossa 1.461,2mi (Δ 142,2mi ≈ dedução FUNDEB realizada) — o E100 nosso realiza a líquida.
4. **Crédito pré-empenhado** (6.2.2.1.2.02 265,9mi): nossas ReservaDotacao não geram lançamento — evento de pré-empenho a criar.
5. Resíduos menores após os 4 acima.
**Cada item vira frente com valor conhecido no gabarito.** Ordem sugerida por impacto/custo: (3) bruta+dedução (toca abertura+E100, dado já existe), (1) créditos (espelho contábil dos decretos), (4) pré-empenho (evento simples), (2) RP (frente nova maior).

## Achado de dados REAL exposto pelo import (2026-07-14)
A MSC OFICIAL do ente reporta `113819900` (demais créditos a receber, DEVEDORA) com natureza **C** em dezenas de linhas (fontes 1501/1600/1759, Σ −11,7mi) — valores a regularizar CREDORES dentro do ativo. Nosso `ATIVO_INVERTIDO` flagou fielmente; é achado de auditoria do dado do próprio município, não defeito nosso. Conferido linha a linha no JSON oficial.

## Outras fontes correlatas (lidas 2026-07-14)
- Tesouro Transparente MSC (página de consulta manual): tesourotransparente.gov.br/consultas/consultas-siconfi/matriz-de-saldos-contabeis-msc
- **www3 Maringá — Demonstrações Contábeis anuais** (pacote NBC TSP 11 completo c/ notas explicativas, PDF por ano 2023-2025):
  `www3.maringa.pr.gov.br/portal/?cod=portal/30/pagina/3749/...` — conferência anual do fechamento.
- Portal transparência (censo completo do que tem/não tem): [[portal-maringa-api-arquivos]].

Relaciona: [[icf-e100-sinal-proposta]] (gaps restantes do Dim I), [[icf-ranking-siconfi]] (fase 2c + gabarito), [[saldos-abertura-2026-maringa]] (o 775mi e a decomposição da DC), [[abertura-exercicio-pcasp]].
