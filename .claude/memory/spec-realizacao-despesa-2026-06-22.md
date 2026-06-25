---
name: spec-realizacao-despesa-2026-06-22
description: "Specs 22-06-2026 item 8 — classificação completa da despesa + processo de realização (empenho/liquidação/pagamento) com lançamento+estorno imutável em colunas separadas. Fontes: Specs 22-06-2026.pdf, Notas-de-empenho-PROC-5837_2020.pdf"
metadata: 
  node_type: memory
  type: project
  originSessionId: 54bff2d1-e062-496b-aaad-a2da27d1b21f
---

Material novo (raiz do repo + `data/Material didático/`) sobre **realização da despesa**. Itens 1-3 da spec já feitos (modal de desdobramento, ver [[spec-revisao-2026-06-01]]); itens 4-7 são a frente Painel/Favoritos (outra sessão). **Item 8** é o tema da despesa. Ver [[contabil-regras-orcamentario]], [[compras-modulo-plano]], [[orcamento-maringa-importado]].

## Classificação completa da despesa (Portaria SOF/MPO 169/2024 + Portaria 42/1999)
- **Institucional:** Órgão → **Unidade Orçamentária** (quem tem autoridade para gastar).
- **Funcional:** **Função** (2 díg., ex.: `12` Educação) **E Subfunção** (3 díg., ex.: `365` Educação Infantil) — DOIS níveis separados, não agregar. Subfunção detalha a função, mas pela **matricialidade** (Portaria 42/1999) pode combinar com função diferente da "natural" → no lançamento escolhem-se as duas de forma independente. No código: `Funcao` + `Subfuncao` (refs globais; lista fechada 28 funções + ~109 subfunções) e `DotacaoDespesa.funcaoId` **+** `subfuncaoId` (FKs independentes). Na nota de empenho aparecem concatenadas (`12.365.0053.2.138` = função.subfunção.programa.ação), mas são campos distintos.
- **Programática:** Programa de Governo → **Projeto/Atividade** (Ação). Projeto = prazo determinado; Atividade = contínua.
- **Natureza da despesa:** categoria.grupo.modalidade.elemento.**subelemento** (ex.: `3.3.90.30.29`; na nota o subelemento `29` aparece destacado).
- **Esfera** (qual orçamento financia) + **Fonte/Vínculo** (+ "vínculo variável", ex.: COVID-19).

Nota de empenho real (Bertioga, `Notas-de-empenho-PROC-5837_2020.pdf`) traz os campos esperados: Órgão/Unidade, Tipo empenho (GLOBAL/ORDINÁRIO/ESTIMATIVO), Evento, Nº, Folha, Data, Processo, Requisição, Reserva, Licitação, Natureza+Sub-elemento, Classif. Funcional (`12.365.0053.2.138`), Vínculo+Vínculo Variável, Crédito (orçamentário), Credor completo, **Valores (Total créditos / Saldo anterior / Valor empenho / Saldo atual)**, Histórico (itens).

## Processo da despesa (4 fases) — REGRA DE OURO
`Solicitação` (pedido de compra/diárias/adiantamento) → `Empenho` → `Liquidação` → `Pagamento`.
**Movimentações NÃO podem ser excluídas nem alteradas** — só lançamento e, se preciso, **estorno** (Lei 4.320/64, LRF 101/00, MTO, TCE). O estorno é **lançamento novo somado em COLUNA À PARTE**. A movimentação da despesa mantém 6 valores:
1. empenhado · 2. estorno de empenho · 3. liquidado · 4. estorno de liquidação · 5. pago · 6. estorno de pagamento.

## Onde está hoje (código) e a LACUNA
Execução já existe sob **Compras** (`src/app/compras.ts` + `src/views/app/compras-{empenhos,liquidacoes,ordens-pagamento}.ejs`), chain `ReservaDotacao → Empenho → Liquidacao → OrdemPagamento`, saldo via `saldo-orcamentario.ts`.

**Gap vs spec:** hoje usa **flip de status + decremento** de contador materializado, não coluna de estorno:
- `empenhos.anular()` → `status:'ANULADO'` + `dotacao.valorEmpenhado decrement` (e bloqueia se já tem liquidação).
- `liquidacoes.cancelar()` → `status:'CANCELADA'` + `empenho.valorLiquidado decrement`.
- `ordens-pagamento.cancelar()` → `status:'CANCELADA'` + `liquidacao.valorPago decrement`.

Ou seja: **all-or-nothing** (cancela inteiro) e **perde a separação bruto×estorno**. A spec quer **estorno parcial** (valor) preservando o bruto, com as 6 colunas acumuladas. Refatorar para esse modelo é o trabalho grande pendente da despesa.

## Conexão com o desdobramento de despesa (em andamento)
A regra "movimentações não podem ser alteradas" **reforça a opção A**: bloquear desdobrar uma conta de despesa que já tem execução (reserva/empenho), espelhando o que fiz em receita ([[contabil-tres-planos-de-contas]] / PR #106). Estorne antes; não reclassifique conta com execução.

## Progresso (decisão: modelo LEDGER)
- **Modelo escolhido (B) ledger** sobre acumuladores: razão `MovimentoEmpenho` por empenho é a fonte da verdade; as 6 colunas = Σ por tipo. `valor` sempre positivo, `tipo` dá o sinal. Sem `@@unique` → estornos/parciais múltiplos livres.
- **Saldos em cascata** (acordados com Marco): saldo do empenho = netEmpenhado − netLiquidado; saldo da liquidação = netLiq(L) − netPago(L); estorno de empenho só morde o não-liquidado; estorno de liquidação só o não-pago. **Tetos sobre a SOMA** (parciais ilimitados). **Anterioridade**: liquidação ≥ empenho, pagamento ≥ liquidação, estorno ≥ doc.
- ✅ **Fase 1 — PR #109** (`feat/despesa-realizacao-ledger`): scaffold (schema+migração `add_movimentos_empenho`+backfill idempotente) + núcleo puro `saldos-empenho.ts` (`resumirEmpenho`/`saldoDaLiquidacao`/`netPagoDaOrdem`/`validarLancamento`, 14 testes) + services empenho/liquidação/OP gravam a razão na transação. `criadoPorId`=`req.user.sub`. **Migração APLICADA no dev** via `migrate deploy` (dev tem 0 empenhos; backfill rodou no-op).
- ✅ **Fase 2 — no mesmo PR #109**: (2a) **ficha de empenho** `/admin/empenhos/:id/ficha` — 6 colunas via `resumirEmpenho` + histórico da razão + link na lista. (2b) **estorno value-driven**: `estornar(valor)` substitui `anular`/`cancelar` nos 3 estágios (valor define parcial/total — **NÃO rotular "parcial/total" na UI**, pedido do Marco); ao zerar o net → ANULADO/CANCELADA. **A RAZÃO virou fonte da verdade da validação**: `criar` (liquidação/OP) valida o teto pela razão (`saldoEmpenho`/`saldoDaLiquidacao`), não mais pelos contadores brutos (senão estornar empenho e depois liquidar furava). Contadores materializados seguem mantidos → `saldo-orcamentario` inalterado. Forms "Estornar" (valor+data, default=saldo) na ficha (empenho) e nas listas de liquidação/OP. Suíte **3003**.
- **Fase 3 — classificação completa.** A `DotacaoDespesa` JÁ respeita 6 das 7 dimensões (unidade/função/subfunção/programa/ação(projeto-atividade)/natureza); faltava só o **Órgão**.
  - ✅ **3a — Órgão** (no PR #109): entidade `Orgao` + `UnidadeOrcamentaria.orgaoId` (institucional Órgão → Unidade); migração `add_orgaos` aplicada no dev; backfill deriva o órgão do prefixo do código da unidade (Maringá: 29 órgãos, 49 unidades); `OrgaosService` (CRUD); ficha exibe Órgão. **Falta 3a-pt2:** admin/tela de órgão + seletor no form de unidade.
  - ✅ **3b — sub-elemento da natureza** (no PR #109): obrigatório no **empenho** (Lei 4.320 / TCE-PR SIM-AM; separa MDE/Saúde). `Empenho.subElementoContaId` → folha analítica da natureza **sob o elemento da dotação** (4 primeiros segmentos), aceita desdobramentos locais. Seletor HTMX no form (`/admin/empenhos/sub-elementos`), exibido na ficha. Reusa `ModeloContabil`/`PlanoContasDespesa` (tabela TCE-PR já importada — 2.352 sub-elementos; extrato em `data/tabela_natureza_despesa_tcepr_2026.csv`). **A dotação fica no elemento; saldo NÃO subdivide por sub-elemento** (LOA→QDD→empenho: saldo apurado na dotação). Migração `add_empenho_subelemento` aplicada no dev. Decisão do Marco: arquitetura **modelo por estado** = o `ModeloContabil` que já existe (Estado→modelo, override no município); override local de sub-elemento = desdobramento (#108). Domínio aprendido (Marco): sub-elemento alimenta MSC→Siconfi→RREO/RGF, limites MDE 25%/Saúde 15%/Fundeb, VPD/ativo/estoque/imobilizado/RPP, NF-e — tudo **épicos a jusante** que consomem o sub-elemento capturado aqui.
  - ✅ **3c esfera** + **3d vínculo variável** (no PR #109): `DotacaoDespesa.esfera` (enum `EsferaOrcamentaria` FISCAL/SEGURIDADE_SOCIAL/INVESTIMENTO, default FISCAL) + `vinculoVariavelCodigo`/`Nome` (detalhamento variável da fonte, ex.: "01.312.0212 - EDUCAÇÃO - CRECHE - COVID-19"). Capturados em `DotacoesDespesaService.criar/atualizar`, exibidos na ficha. Migração `add_dotacao_esfera_vinculo` aplicada no dev. **Classificação completa da despesa = FECHADA** (órgão/unidade/função/subfunção/programa/ação/natureza+sub-elemento/esfera/vínculo). Falta capturar esfera/vínculo no IMPORT da LOA (hoje default).
  - ⏭️ Pendente: **de-para → VPD/ativo** (motor contábil da despesa, E600/E700/E800) — **por modelo** (espelho do `ParametroReceita`); **feedback do Marco: o de/para tem que cobrir a funcional-programática COMPLETA, todos os níveis — não só a natureza/sub-elemento**. Épico [[despesa-eventos-contabeis-proposta]] (NÃO empilhar no #109). E o QDD (detalhar dotação por sub-elemento) + import da LOA popular esfera/vínculo.
  - ✅ **#109 validado AO VIVO** (Maringá, 2026-06-23): empenho real → ficha (órgão/sub-elemento/esfera/6 colunas) → estorno parcial → cleanup, LOA intacta. Épico pronto p/ revisão/merge.
  - Eventual: derivar contadores da razão (hoje escrituração dupla); estorno de liquidação/OP a partir da própria ficha (hoje nas listas).
- Mutações da execução vivem no **`/admin`** (`src/admin/{empenhos,liquidacoes,ordens-pagamento}.ts`); `/app compras` é só leitura.

Reference (consulta na implementação): `data/Material didático/` — MTO 2026 (428p), "Apostila Execução Orçamentária Financeira Contábil", "Manual de Procedimentos - Empenho, Liquidação e Pagamento", MCASP 11ª.
