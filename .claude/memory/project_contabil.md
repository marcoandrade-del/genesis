---
name: spec-modelos-cont-beis
description: "Especificação da feature contábil em andamento (plano de contas, modelos, estados/municípios, lançamentos)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 58f31521-8481-4b22-ac7d-d25384bea060
---

Feature solicitada em 2026-05-21 (documento "Spec Modelos Contábeis" na raiz). **Em andamento.** Fase 1 backend + importador + lançamentos concluídos; telas admin em progresso (3 de 6 entregues em 2026-05-25). Faz parte do projeto [[project_estado]].

## Objetivo
Sistema contábil sobre o Gênesis: plano de contas, movimentações e relatórios. Roda em todos os estados do Brasil — plano de contas, eventos contábeis, memoriais de cálculo e relatórios legais dependem do **modelo contábil** escolhido.

## Entidades e regras

**Estado/UF:** nome, sigla, modelo contábil. 27 UFs importados via seed.

**Município:** nome, UF, modelo contábil.
- Município **herda automaticamente** o modelo contábil do seu estado; usuário pode alterar no município.
- Se o modelo for alterado **no estado**, propaga para **todos os municípios** daquele estado (sobrescreve).

**Modelo Contábil:** descrição. Deve estar previamente cadastrado para ser usado em estado ou município. Relacionado a **um único plano de contas por ano** (município pode adotar plano diferente a cada ano).

**Plano de Contas:** descrição, ano, aponta para uma tabela de eventos padrão (eventos saíram do escopo Fase 1). Hierárquico (contas pai → filho → ... até **7 níveis** — PCASP Estendido: Classe→Grupo→SubGrupo→Título→SubTítulo→Ítem→SubÍtem).
- Constante `NIVEL_MAX = 7` em `src/services/contas.ts`.

**Conta:** código (único por plano), descrição, nível derivado do parent, flag `admiteMovimento`.

**Lançamento (partida dobrada):** cabeçalho + N itens. Valores em `Decimal(18,2)`. Lançamentos são imutáveis (sem update; correção via contra-lançamento).

**ResumoMensalConta:** agregado mensal (município, conta, ano, mês) → totalDebito/totalCredito. Atualizado por upsert na mesma transação do lançamento.

**SaldoInicialAno:** populado por procedimento de virada de ano (fase posterior).

## Regras de negócio críticas
- Só contas do **último nível** (folha) admitem movimento. `admiteMovimento=true ⟺ sem filhos`.
- Não permitir conta-movimento que tenha conta-movimento filha na mesma estrutura pai-filho-... (até 7 níveis).
- Não permitir excluir conta que tenha valores ou contas filho.
- Conta filho nunca pode ficar sem pai.
- Lançamento exige ∑débitos = ∑créditos (Prisma.Decimal, sem float) e ≥1 D + ≥1 C.

**How to apply:** Clean Architecture do Gênesis (schema Prisma → service → rota → admin → testes). Cada feature nova é commitada em sub-tarefas. Cobertura 100% nos arquivos novos é o padrão atual.
