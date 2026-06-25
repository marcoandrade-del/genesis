---
name: rodar-app-admin
description: Como subir e dirigir o app (admin é cookie-auth; cunhar JWT para navegar via script)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 89029b9d-4e10-4cea-b5c8-b2f2d4333e35
---

**Subir:** `npm run dev` (= `tsx src/server.ts`) → porta 3000 (`PORT` no env override), host 0.0.0.0. Banco dev em localhost:5432 precisa estar no ar.

⚠️ **NÃO faz hot-reload** (`tsx`, não `tsx watch`): o server roda o código do startup. Depois de mudar código OU aplicar migração, **reinicie**.

⚠️ **O dev server da :3000 pode estar numa BRANCH diferente de onde sua mudança caiu.** Sintoma clássico: "a feature/campo não aparece na tela" mesmo depois de mergear. Aconteceu 2× com o brasão (2026-06-08): o #56 foi pra `master`, mas a :3000 rodava `feat/sync-modelo-entidades` (branch de contas) que não tinha o master ainda → campo ausente. **Antes de concluir que é bug, cheque a branch que o server serve** (`git branch --show-current` na árvore de onde o server subiu) e `grep` o marcador no arquivo renderizado das duas árvores. Fix: levar a mudança pra branch que o server roda (merge `origin/master` na branch, se não houver overlap de arquivos → trivial) **e reiniciar** o server. Worktrees separados (ex.: feature isolada off master) servem código DIFERENTE da :3000 principal — rodar a feature exige subir um server do worktree (porta própria) ou mergear+reiniciar.

🔎 **Lição de diagnóstico (incidente 2026-06-03, "erro de sistema ao gravar cabeçalho"):** o bug era REAL, não stale server — o `<form action>` do editor `relatorios-editor.ejs` usava o `base` da rota (`/relatorios/cabecalhos`) **sem o prefixo `/app`** → POST do navegador batia em rota inexistente na raiz → **404 default do Fastify** (fora do `/app` notFoundHandler) = "erro de sistema". **Os testes mascaravam:** registram `appRelatoriosRoutes` SEM o prefixo `/app`, e o inject postava em `/relatorios/...` (casando), então 35 testes passavam verdes. **Só o verify de browser real pegou.** Quem revelou foi o **log do server** (`{"msg":"Route POST:/relatorios/cabecalhos not found"}`) — sempre leia o log do processo antes de concluir. Regra geral: forms de view sob `/app` precisam de URL absoluta `/app/...`; inject de teste sem o prefixo NÃO valida isso. Corrigido + 2 testes de regressão que conferem `action="/app/..."` no HTML renderizado.

**Auth do admin** (`/admin/*`): cookie `genesis_admin_token` = JWT **HS256** assinado com `JWT_SECRET` (.env), payload `{ sub: <usuarioId>, email }`. O middleware (`adminAuthMiddleware`) revalida a cada request: precisa de `AdminSistema` ativo **e** `usuario.emailValidado` **e** `usuario.ativo`. Sem cookie → 302 p/ `/admin/login`.

**Dirigir as telas via script** (sem navegador): cunhar o token com `jsonwebtoken` (já é dep do `@fastify/jwt`):
```js
import jwt from 'jsonwebtoken'
const token = jwt.sign({ sub: usuarioId, email }, process.env.JWT_SECRET)
fetch(url, { headers: { Cookie: 'genesis_admin_token=' + token } })
```
- Admin de teste elegível: **marco@teste.com** (senha **demo1234**, resetada 2026-06-03; vale p/ `/admin/login` E `/app/login` — ambos validam contra `Usuario` via argon2). Tem `AcessoEntidade` ESCRITA @ *Prefeitura Municipal de Curitiba* → passa de `/app/contexto`. Achar um admin: `adminSistema.findFirst({ where: { ativo: true, usuario: { emailValidado: true, ativo: true } } })`.
- **App** (`/app/*`): cookie `genesis_user_token` (mesmo JWT_SECRET); login `/app/login` exige credencial válida + `AcessoEntidade` p/ escolher contexto em `/app/contexto`. Telas de login admin↔app têm link cruzado (#48).
- Para **parciais/forms** (GET com ≥2 segmentos, ex.: `/admin/itens-catalogo/form`): mandar header `HX-Request: true`, senão o hook de "página completa" redireciona p/ `/admin`.

**Scripts ad-hoc com Prisma** precisam do adapter pg (não `new PrismaClient()` puro):
`new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })`. Ver [[prisma-migrate-drift-genesis]].

Validei assim as 11 telas do módulo de Compras (todas 200) — ver [[compras-modulo-plano]].
