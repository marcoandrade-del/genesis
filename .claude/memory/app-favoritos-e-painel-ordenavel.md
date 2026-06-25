---
name: app-favoritos-e-painel-ordenavel
description: "Customização do painel /app — barra de favoritos (#102) e reordenar os cards das áreas por arrasto (#105), ambos por usuário. Depois polidos pelo"
metadata: 
  node_type: memory
  type: project
  originSessionId: bebb6b7f-4392-45b6-8ab4-efdcefb3872a
---

# Customizar o painel do /app — favoritos + reordenação (por usuário)

Pedido do Marco (2026-06-22): deixar o usuário customizar o painel `/app`. Entregue em 2 PRs
mergeados em master, depois polidos por outra sessão no **#107** ("finalização da Área de
Trabalho — favoritos, layout dos cards e contexto").

## #102 — Barra de favoritos (`19a87ed`)
- **Reusa o modelo `FavoritoItem`** (já existia) — sem migração. `FavoritosAppService`
  (`idsFavoritos`/`toggle`); ids injetados em `reply.locals.favoritoIds` no preHandler hook
  do menu (junto do `menuApp`), via `Promise.all`.
- Rota `POST /app/favoritos/:itemId/toggle` (JSON), guarda de `PermissaoAcesso` ativa (403) —
  só favorita item que o usuário enxerga.
- Estrela em cada tile dos mega-painéis + barra fixa estilo navegador no `_navbar.ejs`; toggle
  por `fetch` atualiza a barra em tempo real (sem reload), some quando vazia.
- **Gotcha CSS:** `.gx-favbar{display:flex}` do autor venceria o `[hidden]` do UA → precisa
  de `.gx-favbar[hidden]{display:none}` p/ a barra vazia sumir.

## #105 — Painel reordenável por arrasto (`b42156a`)
- Novo modelo **`OrdemItemUsuario`** (`usuarioId × itemId × ordem`, `@@unique`) — **esparso**:
  só há linha p/ quem arrastou; sem linha → ordem global `ItemFuncionalidade.ordem`. Migração
  `add_ordens_item_usuario`.
- `OrdemDashboardService` (`ordemDe`/`definir`/`restaurar`) + função pura `aplicarOrdemRaizes`
  (preferidos primeiro, demais ao fim na ordem original) aplicada no hook → **navbar e dashboard
  seguem a mesma ordem**.
- Rota `POST /app/dashboard/ordem` (lista ordenada filtrada p/ ids permitidos, ou `{reset:true}`).
- Punho HTML5-DnD em cada card + botão "Restaurar ordem". Clique no card continua navegando
  (drag sai só do punho). No e2e, **interceptar o POST** p/ não mutar o banco ([[feedback-drag-debug-muta-banco]]).

`req.user.sub` é o `usuarioId` no `/app` (diferente do admin, que resolve por email).
