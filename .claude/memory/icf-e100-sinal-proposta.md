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

## RESULTADO (2026-07-14) — escolhido (B), aplicado, com uma correção importante ao diagnóstico
- **Passo 1 confirmado:** PCASP estendido OFICIAL do TCE-PR (`data/pcasp_estendido_2026.csv`) marca `6.2.1.2` **CREDORA** e `5.2.1.1.1` **DEVEDORA** → opção **(A) descartada** (a natureza credora está certa; mudá-la corromperia o modelo/emissão). Escolhida **(B)**.
- **Código:** já estava mergeado em **PR #250 (`d7b309c`)** — E100 → `D 6.2.1.1 / C 6.2.1.2` + abertura → `D 5.2.1.1.1 / C 6.2.1.1` + testes. #250 NÃO aplicou no dev (passo gated).
- **Dados aplicados no dev (OK do Marco):** re-seed --apply dos eventos + delete de 4.064 lançamentos ARRECADACAO/BACKFILL_EXEC + re-apply do `scripts/backfill_contabil_execucao.ts`. **`6.2.1.2` agora CREDORA** (Σ SF mês 6 = −1.672.043.043,28; saiu das invertidas). Magnitude preservada, só o sinal.
- ⚠️ **CORREÇÃO ao achado "1673 linhas, todas 6.2.1.2 / despesa OK": estava INCOMPLETO.** O check `MSC_DIM1_ORCAMENTARIA_INVERTIDA` agrupa TODA a classe 5-6 e mostra só amostra de 5 (ordenada) → o `6.2.1.2` mascarava o **`6.2.2.1.1`** (CRÉDITO DISPONÍVEL, despesa). Com o `6.2.1.2` corrigido, o check SEGUE ✗ por `6.2.2.1.1`: natureza C, empenho (ev600) a debita certo, mas **não há `ABERTURA` materializada** (fixação `D 5.2.2.1.1.01 / C 6.2.2.1.1` nunca rodou) → devedora por **execução-sem-abertura**. Causa diferente do E100; pré-existente.
- **ABERTURA MATERIALIZADA (2026-07-14, OK do Marco), em 2 rodadas:** a 1ª expôs 2º gap — a fixação carimbava só FONTE no cc, e a MSC agrupa por conta×cc → as linhas `6.2.2.1.1×dotação` (débitos do empenho) não casavam com as linhas por-fonte da fixação. **Fix: cc da fixação = {fonte, dotacaoDespesaId} — PR #251 (`2b3824c`)** + regeneração da abertura (403 previsões R$ 3.170,2mi + 2.756 dotações R$ 3.381,3mi).
- ✅ **RESULTADO FINAL: `ORCAMENTARIA_INVERTIDA` mês 1 = OK (0 de 8.637 linhas); meses 2-12 de ~1.500 → 1-20 residuais, TODOS achados reais de DADOS:** a dotação estourada do V6 (nat 3.3.71.70, 6.2.2.1.1 +25.000,00) + ~17 dotações com **empenho líquido negativo** (estornos > empenhos; ex. −10,7mi) deixando 6.2.2.1.3.01 devedora. O medidor expondo divergência real = comportamento desejado.
- **Follow-ups:** (a) resíduos = qualidade de dados da captura (empenho líquido negativo por dotação); (b) `FONTE_DIGITO9` acende 2 linhas f99999 (placeholder do import da LOA) — corrigir o DADO; (c) reconciliação da RECEITA no `backfill_contabil_execucao.ts` com premissa de sinal velha (✗ cosmético −1.687mi × +1.687mi); (d) 3 lançamentos ARRECADACAO stray (1 DEMO) no sinal antigo.

## Rodada 2 (2026-07-14, "ataque" do Marco) — quick win + diagnóstico final
- **R$ 500 demo REMOVIDO do `SaldoInicialAno`** (era o único registro da tabela; `seed_saldo_demo.ts` recria se precisar) → **selo do EMISSOR 4/4: `MSC_BALANCO_FECHA` OK** (Σ SF = 0) + partida dobrada + reconciliações; `ATRIBUTO_F_SEM_FONTE` do mês 1 some.
- ⚠️ Removê-lo EXPÔS `MSC_DIM1_CLASSES_COMPLETAS` no mês 1 (razão só tem classes 5-8; os R$ 500 davam a única linha de classe 1) — **prova que o caminho definitivo é a ABERTURA PATRIMONIAL REAL**.
- **Estado Dim I Maringá:** mês 1 = 12/14 (restam CLASSES_COMPLETAS + FONTE_DIGITO9); meses 6-12 = 10/14 (+ `ATIVO_INVERTIDO` e `ATRIBUTO_F_SEM_FONTE`, **ambos rastreados aos 5 lançamentos "— DEMO" de jun/2026**: ciclo IPTU de teste — E550 10k, E100/E200/E560 6k [no sinal ANTIGO = os 3 strays], E570 4k. Limpá-los via serviços [revertem cadeia+ResumoMensal] resolve os dois e os strays de uma vez — PENDENTE de OK).
- **Frente da abertura patrimonial real (o caminho p/ CLASSES_COMPLETAS e atributo-F com dado real):** (i) `SaldoInicialAno` NÃO TEM FONTE (PK entidade×conta×ano) → precisa migração (fonte na PK ou tabela de abertura por cc) + emissor carregar cc no SI; (ii) dados: caixa por fonte CRAVADO (775.079.908,05, 275 pares, `data/abertura-2026/saldos_por_fonte_31-12-2025.json`), mas o RESTO do balanço (classes 1-2 completas + PL) só existe agregado (Anexo 14) — o conta-a-conta exige o **balancete CONTÁBIL dez/2025 da Elotech (gated no Marco exportar)**. NÃO alocar grupos→folhas na mão ([[padroes-do-estado-canonicos]]).

## Rodada 3 (2026-07-14, "pode fazer os dois")
- ✅ **Ciclo DEMO IPTU LIMPO** (5 lançamentos "— DEMO" + movimento Arrecadacao 6k + 2 `LancamentoTributario`; rematerialização exata da previsão 41.016.033→41.010.033). **`ATIVO_INVERTIDO` → ✓ OK; meses 6-12 = 11/14.** Os "3 strays" do sinal antigo do E100 eram estes — zerados.
- ✅ **2 lançamentos "DEMO-SALDO" (mar/set) EXCLUÍDOS (OK "pode consertar o drift"):** os agregados deles estavam DESSINCRONIZADOS (`ResumoMensalConta` faltava nas 4 células; `MovimentoDiarioConta` na contrapartida) — **era o DRIFT REAL que a reconciliação da MSC #228 detectou**. Materializados os 8 agregados faltantes (upsert create-only) + exclusão limpa. **Drift RESOLVIDO: selo do emissor 4/4 em todos os meses (incl. mar/set); `ATRIBUTO_F_SEM_FONTE` ✓.** Lição: `LancamentosService.excluir` pressupõe agregados consistentes (P2025 se faltar célula) — dados pré-drift precisam materializar antes de excluir.
- 🔍 **Recon do portal (API decifrada: `/api/publicacoes?entidade=1&exercicio=YYYY`, query não header):** balancete CONTÁBIL analítico NÃO é publicado — só anexos 4320 agregados (XIV BP, XVI/XVII dívidas úteis p/ decompor passivos) e BI. **Dado da abertura segue gated no export Elotech do Marco.**
- ⚠️ **Design da abertura: entra COMPLETA ou não entra** — importar só o caixa (775mi devedor) sem passivo/PL quebraria o `MSC_BALANCO_FECHA` (Σ SF=0) que ficou verde hoje.
- **Estado Dim I Maringá:** mês 1 = 12/14 (`CLASSES_COMPLETAS` + `FONTE_DIGITO9`); meses 6-12 = 11/14 (+ `ATRIBUTO_F` [os 2 DEMO-SALDO] e `ORCAMENTARIA_INVERTIDA` [achados reais]). Selo do emissor 4/4.

Relaciona: [[icf-ranking-siconfi]] (Dim I/IV), [[padroes-do-estado-canonicos]] (dirige pelo padrão do estado — buscar a fonte oficial, não chutar), [[coordenacao-sessoes]], [[abertura-exercicio-pcasp]] (o que falta materializar p/ zerar o check).
