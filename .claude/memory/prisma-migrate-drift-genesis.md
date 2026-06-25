---
name: prisma-migrate-drift-genesis
description: Banco dev tem drift de checksum; aplicar migração SEM migrate reset (perde dados)
metadata: 
  node_type: memory
  type: project
  originSessionId: 89029b9d-4e10-4cea-b5c8-b2f2d4333e35
---

O banco dev `genesis` (localhost:5432) tem **drift de checksum**: 5 migrações de 2026-06-01 (eventos, programa/ação, orçamento, acesso) foram editadas depois de aplicadas, então `prisma migrate dev` exige `migrate reset`. **NÃO RESETAR** — há dados manuais reais (≈7 usuários, 1 entidade/município, 1 plano de contas + 9 contas, 3 fontes, 3 lançamentos, 2 modelos contábeis) que NÃO voltam por seed.

**Como aplicar uma migração nova sem reset** (Prisma 7 — flags mudaram):
1. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > mig.sql` (gera DDL do estado real do banco → schema novo; inspecionar que não há DROP).
2. Criar pasta `prisma/migrations/<timestamp>_<nome>/` e colar como `migration.sql`.
3. `npx prisma db execute --file <...>/migration.sql` (lê datasource do `prisma.config.ts`; só aceita `--file`, sem `--schema`).
4. `npx prisma migrate resolve --applied <nome>` (registra no histórico com checksum correto).
5. `npx prisma generate` (client não atualiza sozinho — ver [[prisma-generate-apos-migrate]]).

Foi assim que `20260601190000_add_compras_planejamento` entrou. O drift das outras 5 continua (o Marco pode tratar à parte).
