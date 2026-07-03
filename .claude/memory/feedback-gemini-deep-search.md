---
name: feedback-gemini-deep-search
description: "Regra do Marco: ao consultar o Gemini, SEMPRE pedir confirmação 2× — a segunda com DEEP SEARCH. A 1ª resposta mistura apurado/meta e inventa justificativa genérica; o deep search corrige e traz dados novos"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5fbbe85a-1e29-4901-95a0-cbb6af218d7e
---

# Consultas ao Gemini: confirmar 2×, a segunda com deep search

Regra do Marco (2026-07-02): nunca aceitar a primeira resposta do Gemini —
pedir confirmação duas vezes, e na segunda mandar **fazer deep search**.

**Why (caso real, metas fiscais de Maringá):** a 1ª rodada rotulou apurado
como meta, explicou sinal ao contrário e deu justificativas genéricas de
manual ("LOA prevê resultado zero"). O deep search trouxe dados NOVOS e
exatos que fecharam a aritmética ao centavo: DCL inicial 2026 =
−137.507.930,95 → nominal apurado 1º quad = +402.115.811,24 (ΔDCL) →
DCL atual = −539,62mi ✓. Sem o deep search, a hipótese de partida estava
errada (−332,9) e parecia plausível.

**Cuidados que continuam mesmo com deep search:**
- Ele ainda contradiz o slide oficial em pontos (disse meta primário = 0,00
  genérico; o slide da audiência diz "META FISCAL (56,02)" — mantido −56,02).
- Convenção de sinal do resultado nominal: apurado positivo = dívida CAIU;
  a meta veio negativa na convenção oposta. Ao computar nominal ao vivo
  (ΔDCL), cravar UMA convenção e documentar no memorial.

**How to apply:** prompt à 1ª pergunta normal; na 2ª: "confirme fazendo deep
search, cite documento/URL, responda 'não disponível' em vez de estimar".
Validar TUDO contra o banco antes de gravar (ver [[apurados-tce-2026]]).
O MCP gemini-cli local existe mas está SEM AUTH (exit 41 — configurar
GEMINI_API_KEY ou login em ~/.gemini/settings.json p/ eu consultar direto;
re-testado 2026-07-03, segue sem auth — o MCP "conecta" mas toda chamada falha).

Divisão de papéis (Marco, 2026-07-02): **"Gemini acha, Claude verifica e
crava"** — Gemini é minerador de sites, nunca fonte de verdade; a palavra
final vem de fonte primária (documento oficial, banco, PDF).
