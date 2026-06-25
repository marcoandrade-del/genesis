---
name: contabil-import-massa-bypassa-sync
description: Importação em massa do plano-MODELO (scripts importar_pcasp/orcamentario) NÃO passa pelo SincronizadorContas → cópias por entidade defasam; remediar com scripts/ressincronizar_entidades_modelo.ts
metadata: 
  node_type: memory
  type: project
  originSessionId: 99fa53ea-d463-4ed1-8275-54f147ef2e13
---

Footgun arquitetural descoberto em 2026-06-09: as cópias de plano de contas das 4 entidades de **Maringá/PR** estavam com o **fixture antigo** (9 contábil / 4 receita / 4 despesa) em vez do modelo PR real (8761 / 1808 / 3902 + 3 fontes).

**Causa-raiz:** o `SincronizadorContas` (`src/services/sincronizador-contas.ts`) só propaga modelo→entidade no **CRUD conta-a-conta** do admin (contaCriada/Atualizada/Excluida, fonte*). Os importadores em massa (`scripts/importar_pcasp_2026.ts`, `importar_orcamentario_2026.ts`) usam `createMany` direto no plano-MODELO e **NÃO chamam o sincronizador**. Entidades onboardadas (via `EntidadeService.criar`, [[contabil-tres-planos-de-contas]]) ANTES da importação ficam congeladas no estado do modelo daquele momento. O onboarding também não escala: `criar` faz um único `createMany` por árvore → com o modelo real (8761 contas) estouraria o limite de ~65535 parâmetros do Postgres (precisa de lotes).

**Remediação (criada e aplicada):** lógica em `src/services/ressincronizador-modelo.ts` (`RessincronizadorModelo`: `ressincronizarEntidade`/`ressincronizarMunicipio`/`ressincronizarEstado`) — recopia o modelo atual (delete MODELO + recopy em lotes de 1000; FK auto-referente: ordem por código garante pai antes do filho). Guarda: **pula** entidade com `origem=DESDOBRAMENTO` ou execução (lançamento/orçamento) — só recopia cópias 100% MODELO sem execução. Exposta de 2 formas: (a) **botões "Ressincronizar" no admin** — por linha no Estado (todas as entidades do estado) e no Município (entidades do município), em `src/admin/{estados,municipios}.ts` + views; (b) **CLI** `scripts/ressincronizar_entidades_modelo.ts` (`--municipio= --uf= --ano= --apply`, dry-run por padrão) que reusa o service. **Mergeado em master: #65 (squash `ca4791c`, 2026-06-09).** Verificado por SQL no fix de Maringá: diferença simétrica de códigos = 0, 0 parent órfão, modeloContaId 100% íntegro.

**Why:** "modelo é lei, entidade só desdobra" ([[contabil-regras-orcamentario]]) pressupõe que toda mudança no modelo chega na entidade. A importação em massa fura essa garantia silenciosamente.

**How to apply:** sempre que (re)importar um plano-MODELO via script, rodar `ressincronizar_entidades_modelo.ts` (dry-run → conferir → `--apply`) para os municípios já onboardados naquele estado/ano. Solução de fundo (não feita, não pedida): fazer os importadores chamarem o sincronizador, ou expor um botão "ressincronizar" no admin. Relaciona-se a [[feedback-import-diff-antes-de-rodar]] (diferenciar em memória antes de gravar) e [[salvar-erros-em-memoria]].
