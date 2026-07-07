---
name: tce-pr-pit-dados-abertos
description: "PIT/TCE-PR tem download estruturado da execução da despesa (nível EMPENHO, XML, classificação completa incl. fonte) por município/ano — a fonte que torna o Guardião vivo; padrões de URL cravados e amostra de Maringá 2026 validada"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5fbbe85a-1e29-4901-95a0-cbb6af218d7e
---

# PIT/TCE-PR — dados abertos da execução municipal (mapeado 2026-07-06)

O "caminho inexplorado" anotado pela sessão do Guardião existe e é MELHOR que o esperado.
Descoberto com WebSearch/WebFetch nativos + download real (protocolo: achar → confirmar → cravar na fonte primária).

## URLs (cravadas por download real, não por documentação)
- Consulta por município/ano: `https://pit.tce.pr.gov.br/Dados/DadosConsulta/Consulta`
  (POST `/Dados/DadosConsulta/Pesquisa` com `cdMunicipio=<id-interno>&nrAno=<ano>`; Maringá = **15200**)
- **Download direto (sem POST!):** `https://pit.tce.pr.gov.br/Arquivos/{ano}/{ano}_{ibge6}_{Tema}.zip`
  — Maringá = ibge6 **411520**. Temas: `Despesa`, `Licitacao`, `Contrato`, `Convenio`, `Obra`, `Combustivel`, `Diarias`, `Relacionamentos`. **NÃO há tema Receita** (arrecadação continua vindo do relatório TCE-PR, ver [[arrecadacao-maringa-importada]]).
- **Consolidado estadual (399 municípios):** `https://pit.tce.pr.gov.br/Arquivos/{ano}_PIT_TodosArquivos.zip`, anos 2013–2026.
- Periodicidade: gerado 1×/semana a partir das remessas FECHADAS do SIM-AM (amostra de 06/07 foi gerada em 28/06, dados até competência 2026/05-06).

## O que tem dentro (Despesa.zip de Maringá 2026, verificado)
6 XMLs: `Empenho`, `EmpenhoLiquidacao`, `EmpenhoPagamento`, `EmpenhoLiquidacaoEstorno`, `EmpenhoPagamentoEstorno`, `EmpenhoLiquidacaoDocumentoFiscal` (nota fiscal!).
**27.221 empenhos**, Σ vlEmpenho = R$ 1,87 bi, **TODAS as entidades do município** (Prefeitura 23.589, Câmara, Maringá Previdência, IAM, IPPLAM, AMR, consórcios PROAMUSEP/CISAMUSEP/CIMEIV).

Cada `<Empenho>` (atributos XML, self-closing) traz a classificação COMPLETA:
- órgão/unidade, **função/subfunção**, programa, projeto-atividade
- natureza completa (categoria/grupo/modalidade/elemento/desdobramento/detalhamento)
- **fonte em 7 dimensões** (cdFontePadrao, origem, aplicação, desdobramento, detalhamento, grupo, fonte-receita)
- credor (CNPJ/CPF), histórico, ordenador, tipo, `vlSaldoAntDotacao`, mês competência/processamento
- `vlLiquidacao` e `vlPagamento` já agregados no próprio registro de empenho

## Por que importa
É exatamente **função × fonte real, nível empenho** — o insumo dos índices MDE/ASPS ([[lrf-despesa-epico-plano]]), Anexo 5, RREO e do Guardião no Oxy ([[oxy-dashboards-integracao]]) — sem depender de PDF. E serve de **prova real externa** pra validar a execução registrada no Gênesis.


## Conciliação executada (2026-07-06, PR #201 — scripts/importar_execucao_pit.ts)
Read-only, mês × função × fonte, Maringá 2026 jan–mai. Veredito:
- **Balancete Elotech jan–mai = banco AO CENTAVO (1.513,9mi, incl. intra-91)** — a captura CAP-* do dashboard está íntegra.
- **PIT traz o valor EMITIDO (bruto)**; dashboard/balancete o líquido ⇒ Δ −117,3mi ≈ anulações (concentradas em janeiro/estimativas: jan −22,5%; fev–mai ±1–3,5%).
- **De/para de fonte PIT→catálogo QDD: `cdGrupoFonte + cdFonteReceita` sem padding** (1+000→1000, 1+1045→11045, 4+1197→41197). ⚠️ é a fonte da RECEITA — `cdFontePadrao` (despesa) diverge (494≠486) e NÃO casa. Cobre 91,3% do empenhado; pendências de safra antiga listadas no relatório (241687, 2045, 1197, 1045…).
- **Erro do rateio de fonte da captura é REAL e visível** (DRM 1097 +150%, saúde 1303 −21%); p/ true-up por fonte a MELHOR base é o balancete Elotech (mesmos códigos do QDD) — o PIT serve de prova externa do total.
- **True-up EXECUTADO (2026-07-07, #209 — `scripts/trueup_fonte_balancete.ts`):** fonte da execução de Maringá exata ao centavo × balancete até 31/05 (804 dotações, R$ 290,9mi redistribuídos, Σ deltas=0, totais mensais intactos). Reaplicável a cada balancete novo (`--arquivo`/`--fim`).

## Pendências / cuidados
- ~~Confirmar totais × balancete Elotech~~ ✅ feito 2026-07-06 (ao centavo — ver seção acima).
- Receita não existe no PIT → lado da arrecadação permanece com a fonte atual.
- ~~De/para das fontes antigas~~ ✅ RESOLVIDO (#212, 2026-07-07): cobertura 100%. **Codificação do catálogo decifrada: destino(1díg: 1=tesouro/3=federal/4=op.crédito/5=doações) + grupoExercício(1díg: 1=corrente/2=anteriores) + spec(3díg)**; o PIT manda grupo+spec sem o destino. Resolver determinístico no script (composto → DE_PARA de 3 irregulares: 1045/2045 família "via decreto" grupo+spec4, 231150 sem irmão g2 → candidato ÚNICO d+g+spec3). Ambíguos: confirmar por VALOR (pares g1/g2 espelhados).
- XML de 62 MB parseia de boa com string+matchAll (jszip); sax só se um dia vier o consolidado estadual.
- ⚠️ EmpenhoPagamento.xml tem atributos DESALINHADOS pelo gerador do TCE (vlPagamentoBruto="CAIXA") — valor confiável é vlOperacao.
