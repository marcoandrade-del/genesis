---
name: prisma-migrate-engine-bug-7-7
description: Prisma 7.7 migrate engine quebra neste ambiente (H.replace); aplicar migração via psql + registrar à mão em _prisma_migrations
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7655609f-074d-4624-ac8a-6f0d23463aa9
---

No ambiente dev local, o **engine de migração do Prisma 7.7.0 crasha** com `undefined is not an object (evaluating 'H.replace')`. Afeta `prisma migrate diff`, `prisma db execute` e `prisma migrate resolve` (mesmo com `--url`/`--from-url`/`--from-empty`). `prisma validate`, `prisma generate` e o **client em runtime** (via PrismaPg + pg Pool nos scripts/app) funcionam normais.

**Why:** sem o engine, o fluxo da memória [[prisma-migrate-drift-genesis]] (diff → db execute → resolve) não roda. O banco dev também tem drift, então `migrate dev`/`reset` estão fora.

**How to apply** (migração nova, aditiva — testado no PR #60):
1. Editar `prisma/schema.prisma`; `npx prisma validate` confirma.
2. **Escrever a migration.sql à mão** seguindo a convenção Prisma (`CREATE TYPE "Enum" AS ENUM (...)`; `ALTER TABLE "tabela" ADD COLUMN ...`) em `prisma/migrations/<timestamp>_<nome>/migration.sql`. Para colunas/enums nullable é determinístico.
3. Extrair a URL do `.env` e **stripar o `?schema=...`** (libpq não entende): `PGURL="${DATABASE_URL%%\?*}"`.
4. `psql "$PGURL" -v ON_ERROR_STOP=1 -f .../migration.sql`.
5. Registrar no histórico à mão: `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, '<sha256sum da migration.sql>', now(), '<nome_da_pasta>', NULL, NULL, now(), 1);` — checksum = `sha256sum migration.sql | cut -d' ' -f1`.
6. `npx prisma generate` (ver [[prisma-generate-apos-migrate]]).

A `migration.sql` fica commitada e aplica normal num ambiente saudável (`migrate deploy`). **CI não roda migração** (testes mockados, sem DATABASE_URL), então não quebra. Ver [[salvar-erros-em-memoria]].
