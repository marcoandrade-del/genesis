---
name: salvar-erros-em-memoria
description: Regra permanente — todo erro que eu cometer deve virar um arquivo de memória feedback
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e7c5e4bc-c2fc-4b70-a4b9-da9bd1f36c67
---

Sempre que eu cometer um erro (técnico, de processo, de comunicação, suposição
errada, comando que falhou por causa minha, lint/test que quebrou por descuido,
ferramenta usada errado, etc.), no mesmo turno em que reconheço o erro devo:

1. Escrever um arquivo `memory/<slug-do-erro>.md` com `type: feedback` descrevendo
   o erro concreto, o **Why** (causa raiz) e o **How to apply** (regra acionável
   para a próxima vez).
2. Adicionar a linha de índice em `MEMORY.md`.
3. Se já existir memória cobrindo o mesmo erro, atualizar a existente — não
   duplicar.

**Why:** O usuário quer melhoria composta entre sessões. Sem registro, repito o
mesmo erro porque o contexto da sessão anterior some.

**How to apply:** Não esperar o usuário pedir. Reconheceu erro → escreve a
memória antes de seguir. Não inflar com erros triviais de digitação corrigidos
no mesmo edit; o critério é "isso me morderia de novo numa sessão futura sem
o registro?".
