---
name: prisma-generate-apos-migrate
description: "Após alterar o schema Prisma, rodar `npx prisma generate` antes do dev server — `migrate dev` não atualiza o @prisma/client neste setup"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 65c20eb0-4021-4fb2-95c8-30147091b274
---

Neste projeto, após mudar `prisma/schema.prisma` e rodar `npx prisma migrate dev`, o **client em `node_modules/@prisma/client` NÃO é atualizado** automaticamente — fica sem os novos delegates (ex.: `prisma.entidade`). Resultado: o dev server quebra com `Cannot read properties of undefined (reading 'findMany')` em runtime.

**Why:** já bateu duas vezes (Fase 2a com `planoContasReceita`, depois Fase 2 validação com `entidade`). Provavelmente é particularidade do `prisma.config.ts` deste setup. Os testes não pegam porque usam o mock (`prisma-mock.ts`), não o client real.

**How to apply:** sempre rodar `npx prisma generate` (separado) após `prisma migrate dev` antes de subir o dev server ou rodar scripts ad-hoc com tsx. Em CI/build de produção, `prisma generate` já faz parte do fluxo.
