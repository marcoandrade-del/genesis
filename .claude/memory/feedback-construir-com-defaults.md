---
name: feedback-construir-com-defaults
description: "Quando o Marco dá uma direção de spec clara, construir com defaults sensatos em vez de fazer várias perguntas"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bebb6b7f-4392-45b6-8ab4-efdcefb3872a
---

Quando o Marco descreve uma feature com direção razoavelmente clara, prefira **construir
com escolhas sensatas** (anunciando-as) a abrir várias perguntas de esclarecimento. Ele
recusou um `AskUserQuestion` de 2 perguntas e respondeu na lousa o que queria.

**Por quê:** ele trabalha em ritmo rápido (build→test→PR→merge) e considera o vai-e-volta
de perguntas um atrito; confia que eu decido o ambíguo e ajusto depois se preciso.

**Como aplicar:** pergunte só quando a decisão for cara de reverter OU genuinamente
bifurca o produto (ex.: semântica contábil que ele é quem define). Para o resto, decida,
diga "adotei X porque Y", e siga. Caso típico desta sessão: granularidade dos planos —
ele queria seletor na tela com memória por relatório (default desdobrado), não mais
perguntas. Ver [[config-dashboard-granularidade]].
