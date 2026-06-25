---
name: contabil-tres-planos-de-contas
description: "No setor público há 3 planos de contas separados (contábil/patrimonial, receita, despesa); receita e despesa são orçamentários e vão em tabelas próprias"
metadata: 
  node_type: memory
  type: project
  originSessionId: 65c20eb0-4021-4fb2-95c8-30147091b274
---

Entes públicos (diferente de empresa privada) trabalham com **três planos de contas distintos**:

1. **Plano de Contas Contábil** (patrimonial — PCASP). Já implementado no Gênesis via models `PlanoDeContas` + `Conta` (árvore até 7 níveis, `admiteMovimento`). Fonte: PCASP Estendido da STN.
2. **Plano de Contas da Receita** — planejamento/execução **orçamentária** da receita.
3. **Plano de Contas da Despesa** — planejamento/execução **orçamentária** da despesa.

**Why:** receita e despesa são da dimensão **orçamentária** (planejamento e execução), distinta da contábil/patrimonial. Por isso vão em **tabelas separadas** do plano de contas contábil — não reaproveitar `Conta`/`PlanoDeContas` nem o importador PCASP existente.

**How to apply:** ao modelar receita/despesa, criar entidades próprias (separadas de `Conta`). Cada uma tem código hierárquico próprio. Relaciona-se a [[spec-modelos-cont-beis]] e [[project_estado]].

**Status — FASE 1 (lado modelo/TCE) COMPLETA** (PRs #18-#21, mergeados): migration `20260528141348_add_planos_receita_despesa_fonte_recurso` + services + telas admin de **Receita**, **Despesa** (árvores `Conta*`/`PlanoContas*` espelhando o contábil, `admiteMovimento`=analítica) e **Fonte de Recursos** (`FonteRecurso` lista plana por modelo×ano, sem container). Planos de receita/despesa têm **importação CSV** (importadores reusam `parseCSV`/`validar` parametrizado por nivelMax; NIVEL_MAX_RECEITA=12, NIVEL_MAX_DESPESA=10). Sidebar/breadcrumb atualizados. ~1468 testes, 100%.
**FASE 2 (camada Entidade) — EM ANDAMENTO** (PRs #22-#24):
- ✅ #22: schema `Entidade` (sob Município; tipo PREFEITURA/CAMARA/ADM_INDIRETA) + 4 tabelas de cópia por entidade×ano (`ContaContabilEntidade`/`ContaReceitaEntidade`/`ContaDespesaEntidade`/`FonteRecursoEntidade`, com `origem MODELO|DESDOBRAMENTO` + ref fraca ao modelo) + `EntidadeService.criar` (onboarding: copia 3 árvores + fontes do modelo do estado, remapeando parents).
- ✅ #23: CRUD admin da Entidade (criar dispara a cópia).
- ✅ #24: árvore de **despesa** da entidade + **desdobramento**. Cláusula pétrea; só desdobrar analítica; código sugerido sequencial editável.
- ✅ #25 (ABERTO, verde, aguardando merge): replica árvore+desdobramento para **receita** e **contábil** (`ContasReceitaEntidadeService`/`ContasContabilEntidadeService` + admins/views). **Fecha a Fase 2.** Sidebar: "Contábil/Receita/Despesa por Entidade".

**FASE 2 COMPLETA** (PR #25 mergeado). DB local tem admin `showcase@dev.local`/`demo1234` + Entidade `Prefeitura Municipal de Curitiba` + 9 contas contábeis copiadas (3 analíticas: CAIXA, BANCOS, IPTU) + 3 lançamentos de fixture novos (R$ 4500 total, jan/fev/mar 2026).

**FASE 3 (movimentação) — EM ANDAMENTO**:
- ✅ #26 (ABERTO 2026-06-01): refatoração patrimonial Município→Entidade. Destrava o resto.
- ✅ #27 (ABERTO 2026-06-01, base=#26): **LOA-PR1** — cadastros estruturais. Schema `Funcao` + `Subfuncao` (global, seed Portaria MOG 42/1999: 28 funções + 111 subfunções) + `UnidadeOrcamentaria` (por entidade, CRUD com cascade Estado→Município→Entidade). 1641 testes, 100%.
**LOA tem 3 PRs sequenciais (decisão 2026-06-01, granularidade SIAFI cheio, sem créditos adicionais):**
- PR1 #29 (mergeado): Funcao/Subfuncao + UnidadeOrcamentaria. ✅
- PR2 #30 (mergeado): Programa + Acao por entidade×ano. Enums TipoPrograma (FINALISTICO/GESTAO/OPERACOES_ESPECIAIS) + TipoAcao (PROJETO/ATIVIDADE/OPERACAO_ESPECIAL). Acao tem unidadeMedida + metaFisica Decimal. Admin com drill-in Programa→Ações. ✅
- PR3 #31 (mergeado 2026-06-01): `Orcamento` + `DotacaoDespesa` (UO + Função/Subfunção + Programa/Ação + ContaDespesa + Fonte) + `PrevisaoReceita`. ✅ Status enum RASCUNHO→APROVADO→EM_EXECUCAO; APROVADO é imutável (cláusula pétrea), reverte para RASCUNHO enquanto não inicia execução; EM_EXECUCAO terminal. Service valida coerência cruzada das 7 dimensões. Previsão sem dimensão extra (ContaReceita × Fonte). Admin com drill-in `/admin/orcamentos/:id` + totais + alerta de desbalanceamento. 1934 testes, 100% nas 4 unidades novas. **Fecha a LOA.**

**Depois da LOA (Fase 3 cont.):** execução despesa (empenho→liquidação→pagamento) e receita (previsão→arrecadação). Saldo por (conta×FR) com roll-up; consolidação mensal do município (snapshot).

**Tabela de Eventos Contábeis — INICIADA (PR #28 ABERTO 2026-06-01, independente)**:
- ✅ #28: schema `EventoContabil` + `EventoLancamento` (por modelo contábil; código 6 dígitos, máscaras X/Y, pares D-C). Admin completo. **Seed MVP de 31 eventos** cobrindo 12 categorias SIAFEM-SP. 1634 testes 100%.
- Padrão SIAFEM-SP do código: `XX-X-XXX` (XX=transação 10/20/30/40/51/52/53/55/56/61/70/80; X=tipo 0=Normal/5=Estorno; XXX=sequencial).
- PDFs de referência em `data/Material didático/`: `Relatorio-Eventos-2024.pdf` (GDF — 10k eventos) e `tabela_de_eventos sp.pdf` (SIAFEM-SP — adendo teórico).
- **DEFERIDO**: engine que aplica evento+parâmetros → lançamentos contábeis reais, plugada à execução orçamentária da Fase 3.

**Fases seguintes:** Fase 4 — contas bancárias Febraban + CNAB; deferido: Tabela de Eventos + rastreabilidade execução↔contábil. Ver [[contabil-regras-orcamentario]].

## Ciclo orçamentário (contexto que enquadra receita/despesa)
- Começa pelo **Planejamento Orçamentário**: a **LOA** (Lei Orçamentária Anual) — Marco a chama só de **"Orçamento"**. O executivo municipal (prefeitura) envia ao legislativo (câmara municipal) para aprovar; o legislativo pode alterar via **emendas parlamentares**.
- O Orçamento anual especifica, para o exercício seguinte: as **despesas autorizadas** e as **receitas** que serão arrecadadas para custear essas despesas e investimentos previstos.
- Há mais fundamentação teórica a aprender: **fontes de recursos** (provável dimensão/tabela própria) e outros. A definir: como a **execução** (despesa: dotação→empenho→liquidação→pagamento; receita: previsão→arrecadação) se conecta (ou não) à contabilidade patrimonial por partida dobrada.

## MCASP 11ª ed. — estruturas de código e regime contábil (estudado de `data/refs/MCASP-11ed-2024.pdf`)
- **PCASP é um plano único** com contas classificadas por **Natureza da Informação**: classes **1-4 = patrimonial**, **5 = orçamentário (previsão/fixação)**, **6 = orçamentário (execução)**, **7-8 = controle** (inclui DDR – Disponibilidade por Destinação de Recursos). Orçamentário e patrimonial **NÃO são livros separados**: é o mesmo razão por partida dobrada, com lançamentos simultâneos em classes diferentes.
- **Regime**: receita orçamentária reconhecida na **arrecadação** (caixa, Lei 4.320 art. 35); VPA/VPD patrimoniais por **competência** (fato gerador). Mesmo evento gera lançamento orçamentário + patrimonial + controle simultâneos.
- **Natureza da Receita = 8 dígitos** `a.b.c.d.ee.f.g`: Categoria Econômica (1=corrente, 2=capital, 7/8=intraorç) → Origem → Espécie → Desdobramentos → Tipo (8º dígito: 0=agregadora, 1=principal, 2=multa/juros, 3=dívida ativa...). Etapas: Previsão→Lançamento→Arrecadação→Recolhimento.
- **Natureza da Despesa = 6 dígitos** `c.g.mm.ee.dd` (opc. 8): Categoria (3=corrente, 4=capital) → Grupo Natureza GND (1=Pessoal, 2=Juros, 3=Outras Corr., 4=Investimentos, 5=Inversões, 6=Amortização) → Modalidade Aplicação (20-99, gerencial) → Elemento → Desdobramento. Etapas execução: **Empenho→Liquidação→Pagamento** (liquidação = fato gerador da VPD patrimonial).
- **Fonte/Destinação de Recursos (FR) = 3 dígitos** (União 000-499; Estados/DF/Mun 500-999), + dígito de exercício (1=corrente, 2=anteriores, 9=condicionado) e CO (4 dígitos). É o **elo integrador receita↔despesa** (receita destina, despesa consome) e é controlado nas contas DDR (classe 8). Destinação Vinculada vs Livre. **Dimensão própria** — atravessa receita e despesa.
- **FR é LISTA PLANA versionada por ano (NÃO é árvore)**, diferente de receita/despesa. Tabela oficial baixada: `data/refs/FR-2026-estados-municipios.xlsx` (Portaria STN 710/2021 atualizada; 3 abas: **FR**, **CO**, síntese). Aba FR: ~98 códigos (faixa 500-899 em 2026), cada um com `código` + `nomenclatura` + `especificação`, agrupados por blocos temáticos via cabeçalhos de seção: RECURSOS LIVRES (NÃO VINCULADOS) 500-503; VINCULADOS À EDUCAÇÃO 540-599; À SAÚDE 600-659; À ASSISTÊNCIA SOCIAL; etc. Modelar como tabela de referência: codigo único + nomenclatura + especificacao + flag/grupo (livre vs vinculada + área) + ano/versão. CO = marcador de 4 dígitos (1001+), tabela à parte.
- Nas planilhas TCE-PR, o "Nível S/A" = Sintética (agregadora) vs Analítica (folha, admite execução) — equivale ao `admiteMovimento` do PCASP.

## Fontes (TCE-PR "Plano Padrão") e layout — NÃO é o layout PCASP Estendido
Arquivos em `data/` (ignorada): `PC - RECEITA - PARANA - 2026 ....xlsx` e `PC - DESPESA - PARANA - 2026 ....xlsx`. Workbooks multi-aba do TCE-PR; cabeçalho na **linha 7**, dados a partir da linha 8. O conversor `scripts/xlsx_para_csv_pcasp.py` (aba ativa, colunas H/I/N, filtro Status="Ativa") **não serve** — precisa de lógica nova por layout.

- **Despesa** (aba `PC Desp-2026 1.0e-3902`): `H=CÓDIGO` (ex. `3.1.20.41.01.00`, 6 segmentos), `J=TÍTULO`, `K=Nível (S/A)` → S=sintética, A=analítica (admite movimento quando A).
- **Receita** (aba `Plano Receita 2026`): `N=Código` (ex. `1.1.1.2.01.1.1.00...`, ~12 segmentos), `P=dsDesdobramento` (nome curto/descrição), `Q=Especificação` (texto longo), `U=idTipoNivelConta_numerico` → 1=analítica, 2=sintética.
