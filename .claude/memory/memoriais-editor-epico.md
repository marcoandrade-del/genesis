---
name: memoriais-editor-epico
description: "Editor de Memoriais de cálculo (RCL/fonte/pessoal) — bancada ao vivo + governança + vira-modelo; épico COMPLETO, arquivos e fluxo"
metadata: 
  node_type: memory
  type: project
  originSessionId: d45cf36d-e015-4f59-af73-b40b4d0b8bee
---

# Editor de Memoriais de cálculo — épico COMPLETO (2026-07-01)

Os cálculos fiscais dependem de metodologias que variam por TCE estadual. São 3
"memoriais" = composições JSON de prefixos de código: **RCL** (deduções),
**fonte→finalidade** (classificação), **Despesa com Pessoal** (inclusões/exclusões).
Um usuário com poder específico adapta ao seu TCE numa bancada com cálculo ao vivo,
propõe, e o admin aprova. PRs #178→#183 (todos em master).

## Resolver de 3 níveis (chave da arquitetura)
`resolver*(sigla, estadoJson, modeloJson?)` = `parse(estadoJson) ?? parse(modeloJson) ?? default(sigla)`.
Ordem: **Estado override > Modelo > default do código**. 3º arg opcional/aditivo.
Em `src/services/{rcl,fonte-classificacao,despesa-pessoal}.ts`. Testado em `rcl.test.ts`.
Campos JSON: `Estado.{rclComposicao,fonteClassificacao,pessoalComposicao}` e
`ModeloContabil.{...}` (mesmos nomes). **ModeloContabil é COMPARTILHADO entre estados**
→ alterá-lo aflora p/ todos os municípios que usam aquele modelo.

## Fluxo e arquivos
- **Bancada** (poder específico, item `semGrant`): `src/app/memoriais-bancada.ts`
  (`/app/memoriais/bancada` + `/preview` + `/naturezas` + `/confirmar` + `/minhas-solicitacoes`).
  View `src/views/app/memoriais-bancada.ejs` — **design system Wise**, divulgação
  progressiva (1 memorial por vez em accordion + painel Resultado sempre visível:
  RCL/DTP/DTP-RCL% com medidor de limite 48,6/51,3/54 + receita por finalidade).
  Render DOM seguro (sem innerHTML — hook). `PreviewMemoriaisService` (read-only) calcula
  proposto×efetivo.
- **Governança**: `SolicitacaoMemorial` (espelha `SolicitacaoAcessoEntidade`);
  `src/services/solicitacoes-memorial.ts` (`criar`/`listar`/`cancelar`/`aprovar`).
  Admin `src/admin/memoriais.ts` (fila `/admin/memoriais/solicitacoes` com preview
  numérico efetivo→proposto + aprovar/rejeitar). View `src/views/memoriais/solicitacoes.ejs`.
- **Aprovar com modo**: `aprovar(id, adm, { modo, observacao })` — `ESPECIFICO_ESTADO`
  (grava no Estado) | `ALTERAR_MODELO` (grava no ModeloContabil + limpa override do Estado).
  Só grava os memoriais presentes no snapshot. Sem modelo vinculado → erro.

## Verificado ao vivo (Maringá/PR, dados reais)
RCL R$ 2,604 bi, DTP/RCL 44,23%. Remover a dedução do FUNDEB → RCL 2,882 bi / 39,97%.
E2E: propor→aprovar (ambos os modos) grava certo; sempre restaurei Estado+Modelo PR
(dados da Maringá intactos). Nada grava até aprovar.

## Import multi-formato por IA (#184 — FECHA A UX)
Botão "Importar com IA" na bancada aceita xlsx/docx/json/texto e propõe os **3**
memoriais direto nos editores. `src/services/memoriais-import-ia.ts`
(`MemoriaisImportIaService.propor(usuarioId, formato, base64)`): extrai texto
(`lerXlsxBase64` xlsx; `jszip` docx→word/document.xml; utf-8 json/texto) → tenta
JSON **direto** do nosso formato (grátis, sem IA; envelope `{rcl,fonte,pessoal}` ou
composição solta — discriminada pelo campo-array) → senão delega à IA (motor do
usuário, 1 retry). Saída SEMPRE validada pelos parses; o que não valida vira null.
Endpoint `POST /app/memoriais/bancada/importar` (gate + bodyLimit 12MB). `jszip`
agora é dep direta. Nada grava — só preenche os editores e recalcula ao vivo.

## Épico ENCERRADO — nada pendente
Único trabalho contábil restante do produto: **LRF-despesa** (MDE/ASPS reais, RGF
Anexo 5) — gated no QDD (fonte por dotação) que o Marco traz da Elotech.
Relacionado: [[spec-usabilidade-2026-06-09]], [[contabil-rcl-lrf-plano]], [[integracao-receita-eventos]].
