---
name: feedback-drag-debug-muta-banco
description: Dirigir drag-drop do admin via Playwright em script de debug completa o drop e MUTA o banco dev — interceptar os endpoints como o e2e faz
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bebb6b7f-4392-45b6-8ab4-efdcefb3872a
---

Ao depurar o drag-and-drop de `/admin/menus` com scripts Playwright avulsos, eu chamava `page.mouse.up()` ao fim do arraste. Quando a posição final é um alvo válido, o `onEnd` dispara `fetch('/admin/menus/mover|copiar|atalho/item')` **de verdade** → reordenei o itemA e criei uma cópia espúria ("… (cópia)") no banco dev. Tive que restaurar à mão.

**Why:** o e2e (`e2e/drag-drop.spec.ts`) NÃO toca o banco porque faz `page.route('**/admin/menus/mover/item', …)` etc. e responde `{ok:true}`. Meus scripts de debug pularam essa interceptação, então os drops viraram mutações reais.

**How to apply:** ao dirigir UI mutativa do admin fora do harness de teste — (1) replique os `page.route(...)` que interceptam os endpoints de escrita, ou (2) nunca complete o gesto (sem `mouse.up()` sobre alvo válido), ou (3) snapshot+restore. Antes de mexer, anote o estado original (ordem/parentId) pra conseguir reverter. Relaciona com [[feedback-import-diff-antes-de-rodar]] e [[salvar-erros-em-memoria]].
