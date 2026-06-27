---
name: contabil-rcl-lrf-plano
description: "Plano da RCL/LRF — motor parametrizável por Estado (STN default + deltas), per-entidade primeiro; deduções fora do import"
metadata: 
  node_type: memory
  type: project
  originSessionId: 431b9bde-a8b1-4b3b-a10b-481a9bc6be88
---

# RCL / LRF — plano e decisões (2026-06-27)

Destrava do épico LRF (que estava segurado por falta de dados). Marco trouxe a metodologia da RCL.

## Decisões do Marco
- **RCL é por Estado (TCE).** A maioria segue a **STN**; o **Paraná é um pouco diferente** (deltas). → motor com **composição STN como default** + **override por Estado** (consistente com a herança `loaCodigo` por Estado).
- **Mais tarde:** informar a composição **em cada Estado que estiver aberto**. O ideal é (a) um **esquema intuitivo** pro usuário informar, OU (b) **IA no sistema** importando uma planilha xls que define a forma de cálculo e parametriza o sistema. **Guardar como próxima camada** (não fazer agora).
- **Escopo:** **per-entidade primeiro**; consolidação do município (somar as 4 entidades de Maringá: Prefeitura+Câmara+Maringá Previdência(RPPS)+AMR, deduzir intra) depois.

## Metodologia (STN / RREO Anexo 3)
`RCL = Receitas Correntes − Deduções`. Correntes = categoria 1 (Impostos/Taxas, Contribuições, Patrimonial, Agropecuária, Industrial, Serviços, Transferências Correntes, Outras). Deduções (município): contribuição do servidor ao **RPPS**, **compensação previdenciária** (RPPS×INSS), **formação do FUNDEB**. RCL = soma móvel de 12 meses (mês + 11 anteriores) na execução; no LOA é a previsão anual. Limite de pessoal: **54%** da RCL (Executivo municipal).

## Fontes (TCE-PR)
- Memória de Cálculo - Relatórios Fiscais | TCE-PR (share.google/nSMCHL9efMPtOVoFn)
- RREO Anexo 3 RCL 2025 v13-02-2026.xlsx | TCE-PR — download: `lumis.tce.pr.gov.br/lumis/portal/file/fileDownload.jsp?fileId=4936B6209B7EF841019C763A898C2249` (⚠️ não baixa do sandbox; baixar na máquina do Marco p/ extrair a estrutura exata do PR).

## Estado dos dados (⚠️ gap)
- Receitas Correntes (cat 1) COMPLETAS no banco (Maringá 2026: R$ 2,88bi, 375 previsões).
- **Deduções NÃO existem** no plano/previsões (import trouxe receita bruta; sem linhas de dedução/redutora). → 1ª RCL sai com correntes corretas e **deduções a informar** (cadastro/import — próxima camada). Ver [[orcamento-maringa-importado]], [[contabil-import-massa-bypassa-sync]].

## Estrutura oficial do TCE-PR (extraída do xlsx RREO Anexo 3, aba "Mapeamento", 2026-06-27)
⚠️ A planilha que o Marco passou é a **ESFERA ESTADUAL** (Executivo Estadual, ICMS/IPVA/ITCD, Empresas Estatais Dependentes). A **municipal é análoga** (trocar tributos estaduais por IPTU/ISS/ITBI).

**RECEITAS CORRENTES (I)** = soma das subcategorias por `cdCategoriaEconomica+cdOrigem`:
1.1 Impostos/Taxas (−restituições 1.1.1.4.50,1.1.1.2.51,1.1.1.2.52,1.1.1.3.03) · 1.2 Contribuições · 1.3 Patrimonial (−1.3.2.1 −1.3.2.9 rend. previdenciários) · 1.4 Agropecuária · 1.5 Industrial · 1.6 Serviços · 1.7 Transferências (−1.7.1.1.50 −1.7.1.1.53 −1.7.5.1.50 −1.7.1.5) · 1.9 Outras.

**DEDUÇÕES (II)** (nomes oficiais): (1) Contrib. do Servidor para o Plano de Previdência [`1.2.1.5.01..56`]; (2) Compensação Financ. entre Regimes [`1.3.2.1.04`]; (3) Dedução p/ Formação do FUNDEB [`1.7.1` com `cdMarcadorSTN`=3110/3111/3120/3121, `cdFontePadrao`=604; + 1.7.1.1.50/53, 1.7.5.1.50].
**RCL (III) = I − II.** Ainda há a **RCL Ajustada** (endividamento; despesa c/ pessoal) com (−)emendas individuais/bancada (V/VI), (−)transf. p/ remuneração de agentes, (−)outras deduções constitucionais.

⚠️ **Gap real:** o cálculo fiel usa **marcadores TCE** (`cdMarcadorSTN`, `cdFontePadrao`, exclusão de `idPessoa` do RPPS) que **não temos**; e usa **Receita Realizada** (contas 6.2.1.3.x) — é RREO (execução), não LOA. Da nossa LOA dá pra aproximar por código (ex.: FUNDEB recebido `1.7.5.1.50`=R$ 277M está no banco da Maringá). Faithful = capturar os marcadores OU IA-import da planilha de memória de cálculo.

## Build
Motor `RclService` em master (#135): correntes cat 1 − deduções (composição parametrizável). Próximo: deduções NOMEADAS (3 linhas oficiais) + config por Estado (a planilha do TCE-PR é o insumo da IA-import) + RCL Ajustada + consolidação município.
