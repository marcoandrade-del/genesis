---
name: fastify-view-reply-locals
description: "Injetar dados de view compartilhados em todo o /app (ou /admin) via reply.locals + hook, sem tocar cada rota"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7655609f-074d-4624-ac8a-6f0d23463aa9
---

`@fastify/view@11.x` decora `reply.locals` e faz `Object.assign({}, defaultCtx, this.locals, data)` em **todo** `reply.view` (locals explícitos da rota vencem em colisão). Logo, um `preHandler`/hook que seta `reply.locals.X` injeta `X` em todas as views daquele escopo **sem alterar nenhuma rota**.

Usado na Frente A (#66): hook no escopo autenticado do `/app` (`src/app/index.ts`) calcula a árvore de menu permitida 1×/request e seta `reply.locals.menuApp`; o `_navbar.ejs` lê `menuApp` (guardado por `typeof menuApp !== 'undefined'` p/ telas fora do escopo). Rodar em `preHandler` (não `onRequest`) garante `req.user` já populado pelo `appAuthMiddleware`.

Cuidado TS: o `@fastify/view` **não tipa** `reply.locals` — augmentar `declare module 'fastify' { interface FastifyReply { locals?: ... } }`. Bom para C/D (relatórios) ou qualquer dado cross-cutting de view. Ver [[spec-usabilidade-2026-06-09]].
