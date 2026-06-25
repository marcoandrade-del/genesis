---
name: feedback-protocolo-coordenacao
description: Protocolo de coordenação entre sessões Claude simultâneas no Gênesis — ler e atualizar o quadro compartilhado
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 84b1c12d-f42f-464b-8465-c3dd47b6d3b5
---

Quando houver mais de uma sessão Claude trabalhando no Gênesis ao mesmo tempo, seguir o protocolo do quadro [[coordenacao-sessoes]]: **ao iniciar**, ler o quadro antes de tocar código; **ao assumir** um trabalho, preencher a linha em "Frentes ativas" (sessão, branch, arquivos); **ao concluir/abrir PR/mergear**, atualizar o quadro e a data. Antes de editar um arquivo listado em "Zonas de colisão" (hoje: `src/services/__tests__/helpers/prisma-mock.ts`, `prisma/schema.prisma`+migrations), avisar no quadro primeiro.

**Why:** Sessões Claude são processos isolados — não há canal de mensagem em tempo real entre elas. A coordenação só funciona via blackboard compartilhado. O quadro vive na memória do projeto (não na raiz do repo) de propósito: é independente de branch, então uma sessão no branch A vê o que outra escreveu no branch B sem precisar de merge.

**How to apply:** O quadro é `memory/coordenacao-sessoes.md`, injetado a cada sessão por um hook `SessionStart` em `.claude/settings.local.json` (ao lado do `PostToolUse`/sync_memory). Caveats honestos: (1) o hook só vale para sessões iniciadas depois de criado — sessões já abertas precisam reiniciar ou rodar `/hooks`; (2) "atualizar" é decisão do modelo, o hook só lembra, não força; (3) é assíncrono, não chat. Não prometer ao usuário que as sessões "conversam" em tempo real.
