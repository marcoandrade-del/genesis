---
name: ejs-json-em-atributo-de-evento
description: JSON.stringify em atributo onsubmit/onclick precisa de <%= (escapado); <%- mata o handler — prompt/confirm somem e o form submete direto
metadata: 
  node_type: memory
  type: project
  originSessionId: a8d3c023-ba56-439c-b07b-ca3e7a9a2d83
---

# EJS: JSON dentro de atributo de evento HTML

Bug real (mestre desde o #44, corrigido no PR #69 `9958f4b`): `onsubmit="...prompt('x', <%- JSON.stringify(nome) %>)..."` renderiza aspas **cruas** dentro do atributo delimitado por `"` → o parser de HTML termina o atributo ali, o handler vira JS inválido e o form **submete sem prompt/confirm** (renomear enviava o nome antigo; excluir não confirmava). Sintoma p/ usuário: "cliquei e nada mudou".

**Regra:**
- Em **atributo de evento HTML** (`onsubmit`, `onclick`…): `<%= JSON.stringify(x) %>` — as aspas viram `&#34;` e o navegador decodifica entidades ao parsear o atributo, entregando JS válido.
- Em **bloco `<script>`**: `<%- JSON.stringify(x) %>` (sem escape) — ali entidades NÃO são decodificadas; `<%=` quebraria o JS.

Teste de regressão: `src/app/__tests__/relatorios-pastas.test.ts` ("onsubmit das pastas… aspas escapadas"). Padrão preferido no admin: interceptor `data-confirm-*` (não tem esse problema).
