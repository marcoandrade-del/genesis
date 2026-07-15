---
name: feedback-split-sql-comentarios
description: "Erro 2026-07-15: split de migration.sql por ';' + filtro startsWith('--') pulou TODOS os statements (comentários no meio dos chunks); o script disse 'DDL aplicado' sem aplicar nada e REGISTROU a migração em _prisma_migrations"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 689c5fca-4b0c-4a9d-802f-cbb7328d48f3
---

# Split de SQL por ';' com filtro de comentários = statements silenciosamente pulados

Ao aplicar `20260715120000_add_receita_deducao` no dev via script (bug do engine 7.7
obriga SQL direto), fiz `sql.split(';').filter(s => s && !s.startsWith('--'))`.
Como os comentários `-- AlterEnum` ficam NO MEIO dos chunks, TODO chunk começava
com `--` → todos filtrados → **nenhum statement rodou**, o script imprimiu
"DDL aplicado." e registrou a migração em `_prisma_migrations`. O erro só apareceu
depois, como `invalid input value for enum` no seed.

**Why:** filtro de comentários por prefixo do chunk ≠ remover linhas de comentário;
e o log de sucesso era do fluxo, não do efeito.

**How to apply:**
- Para aplicar migração via driver: **statements explícitos um a um** no script
  (copiar cada ALTER como string própria) — não parsear o .sql na mão.
- SEMPRE verificar o EFEITO REAL depois (information_schema.columns / pg_enum),
  não confiar no print de sucesso — o `_fix_migracao.ts` deste dia é o padrão.
- Se registrar em `_prisma_migrations`, registrar SÓ depois da verificação de efeito.
