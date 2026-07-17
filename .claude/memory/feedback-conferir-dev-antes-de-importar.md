---
name: feedback-conferir-dev-antes-de-importar
description: "Antes de importar/onboardar um município no dev compartilhado, conferir se ele já existe (município/entidades) — o import é idempotente e SOBRESCREVE dados de outra frente sem avisar"
metadata:
  node_type: memory
  type: feedback
  originSessionId: fdf96195-b214-468c-9996-45157e13fb93
---

# Conferir o dev ANTES de importar/onboardar um município (2026-07-17)

Antes de rodar `importarMunicipio(...)` (ou qualquer onboarding) no **dev compartilhado**, checar se o município/entidades **já existem** — por nome/estado. O import é **idempotente e sobrescreve**: `garantirEntidade` casa a entidade **pelo nome**, e `escreverReceita`/`escreverDespesa` apagam previsões/dotações/CAP-* que não estão na escrita atual. Ou seja, importar por cima de um município pré-existente **destrói silenciosamente** os dados que estavam lá.

**Why:** aconteceu com Paranaguá (2026-07-17). Eu concluí "nunca importado" porque não achei um *runner* commitado — mas Paranaguá já estava no dev desde ~09-10/jul (import IPM bespoke #229, 5 entidades). Meu import SICONFI (mesmos NOMES de entidade nos 3 poderes) casou por nome e **sobrescreveu** o IPM da Prefeitura/Câmara/Previdência, deixando Fundação+CAGEPAR órfãs e o consolidado contaminado. O Marco pediu **reverter** → tive de **re-importar o IPM** (o dado antigo já tinha sido apagado; não dá pra "des-sobrescrever"). Deu certo (ao centavo), mas foi retrabalho evitável.

**How to apply:**
- Antes de `--apply` de um import: `prisma.municipio.findFirst({nome, estadoId})` + `entidade.findMany({municipioId})`. Se existir, PARAR e decidir com o Marco (sobrescrever? outro nome? outra frente é dona?).
- "Sem runner commitado" **NÃO** significa "não está no dev" — imports bespoke/interativos deixam dado sem deixar script.
- Idempotência que apaga é ótima pra re-rodar a MESMA frente, mas é uma armadilha entre frentes que compartilham nomes de entidade. Ver [[git-tree-compartilhada-entre-sessoes]], [[feedback-rm-so-do-que-criei]].
- Reverter um import que sobrescreveu = re-importar a fonte anterior (idempotente restaura), não "apagar" (o dado velho já foi).
