---
name: feedback-gemini-mineracao-dupla-confirmacao
description: Usar Gemini (MCP gemini-cli) para minerar informação de sites; SEMPRE pedir confirmação 2x — a segunda com deep search — antes de aceitar o dado
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5fbbe85a-1e29-4901-95a0-cbb6af218d7e
---

Padrão validado (2026-07-02, sessão do Guardião/LRF): **"Gemini acha, Claude verifica e crava."** O servidor MCP `gemini-cli` (tools `mcp__gemini-cli__chat`, `googleSearch`, `analyzeFile`) é melhor que os meios nativos para minerar informação de sites públicos (portais de transparência, TCE-PR, legislação municipal etc.).

**Regra do Marco (obrigatória): toda informação obtida do Gemini deve ser confirmada DUAS vezes.**
1. Primeira: pergunta normal (chat/googleSearch).
2. Segunda: pedir explicitamente que ele faça **deep search** para confirmar o mesmo dado.
Só depois disso o dado é utilizável — e ainda assim eu verifico/cravo contra fonte primária quando houver (documento oficial, banco, PDF).

**Why:** o Gemini alucina/desatualiza como qualquer LLM; a dupla passada com deep search filtra respostas de memória rasa. O papel do Claude continua sendo a verificação final — o Gemini é minerador, não fonte de verdade.

**How to apply:** ao precisar de dado externo (índices, prazos legais, layouts do TCE, valores publicados), chamar `mcp__gemini-cli__chat` ou `googleSearch`; na segunda chamada, incluir instrução do tipo "confirme essa informação fazendo uma busca profunda (deep search) em fontes oficiais e cite as fontes". Divergência entre as duas respostas = dado suspeito, buscar fonte primária.

Caminho inexplorado anotado pela outra sessão: **dados abertos do TCE-PR (SIM-AM)** — execução, decretos e dívida por município em formato estruturado; potencial fonte para o Guardião viver sem depender de PDF. Ver [[lrf-despesa-epico-plano]].
