---
name: oxy-manual-interpretacao-fiscal
description: HANDOFF p/ a sessão OXY Dashboards — manual de interpretação fiscal para a IA de análise (regras por indicador, ressalvas de auditor, requisitos p/ análises encaminháveis a terceiros); o Gênesis fornece os números via contrato 1.9.0
metadata:
  type: reference
---

# Manual de interpretação fiscal — para a IA de análise do OXY Dashboards

**De:** sessão SYNC (Gênesis) · **Para:** sessão OXY Dashboards · **Pedido do Marco (2026-07-07):**
"ensinar" a leitura de auditor à IA do OXY. Como a IA do OXY é configurável (Anthropic
por padrão), o conhecimento entra por DOIS canais: (1) números SEMPRE do contrato de
dados do Gênesis (nunca calculados/lembrados pela IA); (2) interpretação por este
manual, embutido no system prompt da "Análise Profunda". Validado com dados reais de
Maringá e contra os documentos oficiais (RREO/RGF/TCE-PR).

## Princípio arquitetural (INEGOCIÁVEL)
**O Gênesis CALCULA e EXPLICA; o OXY EXIBE e NARRA.** Todo número citado numa análise
deve existir no payload consumido (memoriais têm `linhas` abertas + `baseLegal`). Se o
dado não veio no payload, a análise diz "não disponível na base" — NUNCA estima. Isso é
o que torna a análise encaminhável a terceiros sem risco.

## Fonte de dados (Gênesis, contrato `memoriais-lrf` 1.9.0)
`GET {GENESIS}/api/memoriais/contrato` (checar versao/MAJOR antes de consumir; Bearer
GENESIS_API_TOKEN). Recursos: `guardiao` (9 indicadores c/ memorial+baseLegal+nivel),
`dcl`, `rgf-simplificado?q=1|2|3`, `rcl`, `rcl-consolidada`, `metas-fiscais`,
`disponibilidade-fonte`, `indices-constitucionais`, `valores-mensais`, `saldo-bancario`.

## Regras de interpretação por indicador

### DCL — Dívida Consolidada Líquida (a mais mal-entendida)
- DCL = Dívida Consolidada − (caixa + haveres − RP processados). **Teto 120% da RCL
  (Res. Senado 40/2001); alerta 108% (LRF art. 59 §1º, III). NÃO EXISTE PISO.**
- **DCL NEGATIVA é legal e é o melhor caso**: caixa supera a dívida total. Frase-modelo:
  "as disponibilidades (R$ X) superam o estoque da dívida (R$ Y) — folga de Z p.p.
  até o limite legal".
- **4 ressalvas de auditor que TODA análise de DCL negativa deve considerar:**
  1. **Vinculação do caixa**: grande parte é FUNDEB/saúde/convênios (em Maringá, ~89%
     vinculado na abertura 2026) — não pode quitar dívida com recurso vinculado; a
     folga REAL é menor que o número.
  2. **Tendência de acúmulo**: caixa crescendo rápido pode indicar subexecução
     orçamentária (obra não feita = caixa sobrando) — pergunta de mérito, não infração.
  3. **Passivos fora da DC**: déficit atuarial do RPPS e contingências judiciais não
     aparecem no Anexo 2 — citar como limitação do indicador.
  4. **Precatórios**: se há vencidos e não pagos na DC com caixa alto, apontar o
     contraste (rende apontamento em tribunal).

### Despesa com Pessoal (DTP)
Teto 54% da RCL (Executivo municipal, LRF art. 20); prudencial 51,3% (art. 22 —
veda reajustes/admissões); alerta 48,6% (art. 59). Distinguir base: EXECUTADA
(liquidada, oficial do RGF) × AUTORIZADA (projeção). Estourar prudencial já tem
consequência jurídica — análise deve dizer qual faixa e o que ela implica.

### Garantias (22% RCL) e Operações de Crédito (16% RCL; ARO 7% próprio)
Res. Senado 43/2001. Zero é comum e saudável em municípios. ARO estourada contamina
a situação mesmo com as demais dentro do limite.

### MDE (25%) e ASPS (15%)
São **MÍNIMOS constitucionais** (CF art. 212; LC 141) — a leitura INVERTE: abaixo do
mínimo = descumprimento; acima = ok. Nunca chamar de "limite" sem dizer que é piso.

### Metas fiscais e Δs
Meta é FIXA (LDO/LOA inicial); autorizado é VIVO (decretos). **Δ ≠ 0 é informação,
não erro** — quantificar e explicar a origem (créditos adicionais). Distinguir sempre
APURADO × META × PROJEÇÃO (erro clássico das IAs; ver [[feedback-gemini-deep-search]]).

### Temporalidade
Portal da transparência = tempo quase real; TCE = homologado com 20–90 dias de atraso.
Quadrimestre em andamento = "posição parcial" (dizer explicitamente). Toda análise
carimba a data-base dos dados.

## Requisitos para análises ENCAMINHÁVEIS a terceiros (gestor → prefeito/câmara/imprensa)
1. Carimbo: entidade, exercício, data-base, versão do contrato, data da análise.
2. Base legal citada em cada afirmação normativa (o memorial já traz `baseLegal`).
3. Linguagem: "indica/sugere/aponta" — nunca "garante/comprova conformidade".
4. Disclaimer fixo: "Análise gerada por IA a partir dos dados do sistema; não
   substitui parecer contábil-jurídico nem manifestação do controle interno."
5. Números com fonte (qual demonstrativo/linha) — o leitor precisa poder auditar.
6. Se houver divergência entre fontes (ex.: balancete × balanço), REPORTAR a
   divergência com as datas de geração — nunca escolher silenciosamente.

## Caso de calibração (teste de qualidade da IA)
Perguntar: "a DCL de Maringá é −R$ 539,6mi, isso é um problema?" — resposta boa cita:
legalidade (sem piso), significado (caixa > dívida), folga vs 120%, E as 4 ressalvas
(vinculação ~89%, acúmulo +153mi/ano, RPPS fora, precatórios 52,6mi). Resposta ruim:
só "está dentro do limite". Ver o parecer-modelo completo em
[[saldos-abertura-2026-maringa]] (sessão de 2026-07-07 do Gênesis).
