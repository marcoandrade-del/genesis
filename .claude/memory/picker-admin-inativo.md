---
name: picker-admin-inativo
description: Pendente — picker de usuário (lupa do admin no modal Sistema) lista usuários inativos como selecionáveis
metadata: 
  node_type: memory
  type: project
  originSessionId: e7c5e4bc-c2fc-4b70-a4b9-da9bd1f36c67
---

No modal "Novo/Editar Sistema", o picker de Administrador (offcanvas
`/admin/lookup/usuarios`) lista TODOS os usuários, ativos e inativos,
marcados apenas com badge "Inativo". A regra de negócio do CLAUDE.md
("Trava de Administrador: Nenhum Sistema ou Módulo pode ficar sem ao
menos um administrador ativo") implica que selecionar inativo deveria
ser proibido — mas a UX permite escolher e só descobrir o erro depois.

Código: `src/admin/lookup.ts:8` — `prisma.usuario.findMany` sem filtro
`where: { ativo: true }`.

**Decisão pendente** (perguntar ao Marco):
- (a) Filtrar `ativo: true` no findMany → inativos somem do picker
- (b) Manter listagem + bloquear seleção client-side em inativos (cursor
  not-allowed + tooltip)
- (c) Manter como está — backend já barra no submit, badge é informativo

Vinculado a [[salvar-erros-em-memoria]] (achado registrado para não
esquecer entre sessões).
