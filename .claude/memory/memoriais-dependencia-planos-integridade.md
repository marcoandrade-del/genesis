---
name: memoriais-dependencia-planos-integridade
description: "Integridade planos×memoriais: dependência por CÓDIGO/prefixo (não FK). DECISÃO: inteligência no sistema (ResolvedorDeVinculos + validação em autoria/seleção/exclusão + painel de saúde), FK só reforço pontual. A construir depois."
metadata: 
  node_type: memory
  type: project
  originSessionId: 431b9bde-a8b1-4b3b-a10b-481a9bc6be88
---

Item de trabalho FUTURO (Marco pediu p/ guardar em 2026-07-01, não implementar ainda): fechar a integridade referencial entre os 3 planos de contas e os memoriais/eventos.

⏸️ **AGUARDANDO (decisão Marco 2026-07-01): ESPERAR o épico do [[memoriais-editor-epico]] pousar antes de começar.** Aquele épico (Editor de Memoriais, outra sessão, PRs #178→#183) está reescrevendo esta zona (rcl/memorial/fonte/schema/demonstrativos/composição-por-Estado) e JÁ inclui um **"resolver de 3 níveis Estado>Modelo>default"** — muito próximo do `ResolvedorDeVinculos` proposto aqui. **NÃO duplicar:** quando a integridade for feita, a validação (autoria/seleção/exclusão + painel + "ver o que quebrou") deve REUSAR/ESTENDER o resolver do épico, não criar outro. Começar antes = colisão + alvo em movimento. Retomar quando o épico estiver em master e a árvore limpa.

**Como os memoriais dependem dos planos hoje — por CÓDIGO (prefixo), sem FK:**
- RCL (`rcl.ts`): previsões com código `startsWith('1')` = correntes; deduções por prefixos da composição do Estado (`ComposicaoRcl`).
- Despesa c/ Pessoal / Guardião (`despesa-pessoal.ts`, `memorial-guardiao.ts`): dotações casando prefixos (`3.1`, `3.3.90.34`…) de `ComposicaoPessoal`; despesa por função via `funcao.codigo`.
- Fonte/Finalidade (`fonte-classificacao.ts`): fonte por prefixo (`ClassificacaoFonte`).
- Tabela de Eventos (`ParametroReceita`/`ParametroDespesa` no schema): de/para NR→VPA/VPD aponta contas por **código string** (`contaContrapartidaCodigo`, `contaAtivoCodigo`, `contaVpdCodigo`, `contaPassivoCodigo`) — **NENHUMA FK**. Ver [[integracao-receita-eventos]] e [[despesa-eventos-contabeis-proposta]].

**Integridade na exclusão de conta (contas-*-entidade.ts `excluir`) — PARCIAL:**
- Bloqueia (✅): conta com filhos (checagem no service) e conta com movimento/orçamento — `LancamentoItem`, `PrevisaoReceita`, `DotacaoDespesa` têm FK obrigatória → Prisma P2003 (Restrict implícito) tratado como ErroNegocio.
- NÃO bloqueia (❌): conta referenciada só em `ParametroReceita`/`ParametroDespesa` (sem FK, sem checagem). Logo, **conta sem movimento usada só no de/para PODE ser excluída** → parâmetro órfão. No próximo evento: `motor-eventos-receita.ts saldoDaConta` retorna **0 silencioso**, ou `resolverContas` lança **E703** ("conta não existe").
- Os memoriais por prefixo (RCL/DTP) ficam protegidos TRANSITIVAMENTE (a conta na previsão/dotação não deixa excluir pela FK) — o buraco é só o de/para dos eventos.

**DECISÃO DE DIREÇÃO (Marco confirmou 2026-07-01): INTELIGÊNCIA NO SISTEMA > FK.**
Não amarrar tudo no banco. A FK resolve só 1 dos 4 momentos (e mal): não sabe FK-ar PREFIXO, não lida com escopo MODELO×ENTIDADE nem por ANO, e não responde às 2 perguntas reais do Marco — (1) "não usar conta inexistente no cálculo" (validação na AUTORIA) e (2) "não selecionar memorial com contas inexistentes p/ aquele modelo" (check de COMPATIBILIDADE ao vincular). Esses dois são lógica de app, não constraint.

**Estratégia escolhida — "FK mole" que a aplicação faz cumprir**, via um **`ResolvedorDeVinculos`** central (primeira peça a construir): dado (memorial/parametrização + plano modelo OU entidade/ano) → devolve `{ resolvidos, faltantes, prefixosVazios }`. Com essa peça, ligar a validação em 3 momentos:
1. **Editar de/para/memorial** (autoria): código exato inexistente → bloqueia; prefixo que não casa nada → avisa.
2. **Vincular entidade / abrir exercício / escolher memorial** (compatibilidade): roda contra o plano DAQUELA entidade/ano e lista faltantes ANTES de usar. ← responde a pergunta 2 (a mais importante).
3. **Excluir/renomear conta** (mutação): consulta o catálogo e dá mensagem útil ("usada no de/para do evento X / memorial RCL") em vez de P2003 cru; bloqueia/avisa.
+ **Painel de saúde**: por entidade/exercício, lista "referências quebradas" (reusa o Resolvedor).

**REQUISITO DE UX (Marco 2026-07-01) — "VER O QUE QUEBROU":** sempre que um **memorial de cálculo OU um demonstrativo** quebrar (referência que não resolve), NÃO basta bloquear/avisar seco — dar ao usuário a **opção de VER o detalhe navegável da quebra**, porque são MUITAS contas e a ligação é complexa; ele precisa enxergar o que fez pra diagnosticar e corrigir. A visão deve mostrar a CADEIA completa: memorial/demonstrativo → linha/regra afetada → código/prefixo esperado → o que existe vs falta no plano daquela entidade/ano → **atalho pra corrigir** (editar o de/para, ou ir à conta no plano). Vale tanto no momento de CÁLCULO/render do demonstrativo (link "ver por que não fechou / ver vínculos quebrados") quanto no painel de saúde (drill-down). O `ResolvedorDeVinculos` já deve devolver dados ricos o bastante (não só um booleano) pra alimentar essa tela: por faltante, qual memorial/linha e qual código/prefixo.

**FK só como REFORÇO PONTUAL** onde a referência é exata E no mesmo escopo (`Parametro(modelo)→conta(modelo)` com `Restrict`) — opcional, detalhe de implementação, não a estratégia.

**Ordem de ataque:** (1) `ResolvedorDeVinculos` (peça única, reusável); (2) validação no editar do de/para + check no selecionar; (3) mensagem no excluir; (4) painel de saúde. Não mexe no schema no começo. Preservar a flexibilidade por prefixo/composição-por-Estado (intencional). Cuidado com [[contabil-import-massa-bypassa-sync]] (desdobramentos por entidade podem divergir do modelo).
