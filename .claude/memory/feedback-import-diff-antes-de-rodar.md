---
name: feedback-import-diff-antes-de-rodar
description: "Antes de rodar qualquer importador contra o banco dev compartilhado, diferenciar arquivo×banco EM MEMÓRIA; e openpyxl lê código numérico como float"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b22196d3-901c-4fa3-b6b5-c7adc256cb57
---

Ao versionar o import do CATMAT 2026 (dados já existentes, 162.919 itens), rodei o importador "idempotente" (`createMany skipDuplicates`) contra o banco dev **para validar** — e ele **inseriu 3.376 duplicatas** (162.919 → 166.295), depois de eu ter dito ao Marco que "não mexeria nos dados". Causa raiz: meu conversor fazia `str(cod)` de células que o **openpyxl lê como float** → gerava `"431794.0"` em vez de `"431794"`. Como o código `.0` não colidia com o `431794` já gravado, `skipDuplicates` não pulou — criou item duplicado. Revertido com `deleteMany` filtrando `codigo contains '.'` + `criadoEm` recente (3.376 exatos, FK-safe pois recém-criados).

**Why:** "idempotente via skipDuplicates" só é seguro se a CHAVE (`@@unique[tipo,codigo]`) tiver a MESMA representação dos dados existentes. Uma diferença de formatação (`431794` vs `431794.0`, zeros à esquerda, espaços) faz a unique não casar → insere duplicata silenciosa. E rodar contra o banco compartilhado "só pra testar" é uma escrita real, não um dry-run.

**How to apply:**
1. Antes de rodar import contra o dev DB compartilhado, **diferencie arquivo×banco EM MEMÓRIA** (carrega ambos os conjuntos de chaves, calcula file-only/db-only). Se file-only > 0 quando deveria ser 0, há mismatch de formatação — investigar ANTES de escrever.
2. **Normalize chaves numéricas** de planilha: openpyxl/`data_only` devolve int OU float por célula; coaja a inteiro (`str(int(v))` quando `isinstance(v,float)`), nunca `str(v)` cru. Vale p/ qualquer código numérico (CATMAT, etc.).
3. Não tratar "idempotente" como sinônimo de "não escreve". Se prometi não mexer nos dados, valido com leitura/diff, não com o próprio import.
Relaciona-se a [[salvar-erros-em-memoria]] e [[rodar-app-admin]].
