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

## Build
Motor `RclService` (composição parametrizável, default STN, por entidade) + demonstrativo RREO Anexo 3. Config por Estado + UI/IA-import = camadas seguintes.
