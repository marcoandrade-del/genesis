---
name: contabil-regras-orcamentario
description: "Regras de negócio do orçamentário — modelo TCE imutável vs desdobramento da entidade, saldo por fonte de recurso com rollup, fonte→contas bancárias (Febraban)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 65c20eb0-4021-4fb2-95c8-30147091b274
---

Regras dadas pelo Marco (2026-05-28) para o sistema orçamentário. Complementa [[contabil-tres-planos-de-contas]].

## Estrutura de contas: modelo (TCE) é lei; entidade só desdobra
- O **modelo contábil de cada estado (definido pelo TCE)** deve ser obedecido pelos municípios daquele estado. O plano (contábil, receita ou despesa) de cada **exercício/ano** é lei para os municípios.
- **Entidades** (prefeituras, câmaras, administração indireta) **NÃO podem alterar** as contas que vêm do TCE (modelo) — em nenhum dos três planos.
- **Cláusula pétrea (esclarecido 2026-05-28):** no nível da ENTIDADE não se edita nem exclui NADA (nem os próprios desdobramentos). A **única** ação da entidade é **desdobrar conta analítica**. Edição/exclusão de contas só no **modelo do estado** (onde o admin do TCE tem CRUD completo). Ao desdobrar:
  - a conta desdobrada **vira sintética** (deixa de admitir movimento);
  - as contas-filho criadas são `DESDOBRAMENTO` e **necessariamente analíticas** (admitem movimento);
  - essas filhas podem ser desdobradas de novo, recursivamente.
  - **Código do filho:** sistema **sugere sufixo sequencial** (`X.01`, `X.02`…), mas o usuário pode alterar; **validar código repetido** na árvore da entidade.
- **Dimensão Entidade — CONFIRMADA (2026-05-28):** criar entidade `Entidade` vinculada a `Município` (prefeitura, câmara, adm. indireta). **`Entidade` é a dona da execução e das árvores copiadas; `Município` vira só agrupador geográfico** (estado → município → entidades). É o nível onde vivem os **desdobramentos, contas bancárias, saldos e a execução** orçamentária. O admin de receita/contábil já construído é a administração do **modelo/TCE** (correto); a camada da entidade é território novo.
- **Migração (fase 2):** o `Lancamento` patrimonial e os agregados `ResumoMensalConta`/`SaldoInicialAno` hoje referenciam `Município` → passarão a referenciar `Entidade`. Refatora código existente já testado.
- **Desdobramentos — CONFIRMADO (cópia da árvore por entidade):** vale **igual para os TRÊS planos** (contábil, receita e despesa). O gatilho da cópia é a **criação da entidade**, que pode ocorrer **a qualquer momento do ano** (NÃO é um batch de início de exercício): ao criar a entidade, o sistema **busca o plano padrão do estado** (do exercício) e disponibiliza uma **cópia completa das árvores do modelo** (contábil + receita + despesa); cada conta tem `origem = MODELO | DESDOBRAMENTO`. Desdobrar uma conta-modelo analítica → ela vira sintética e ganha filhos `DESDOBRAMENTO` analíticos (recursivo). Contas `MODELO` são imutáveis para a entidade; só `DESDOBRAMENTO` é editável. **Implicação:** precisa de processo de sincronização quando o TCE altera o modelo do exercício.

## Contexto de produto: SaaS multi-tenant / onboarding
- O Gênesis é vendido como **SaaS**, operando em **vários estados ao mesmo tempo**. Duas situações a prever: (a) **migrar clientes atuais** (criar base inicial) e (b) **onboarding de novos municípios a qualquer momento**.
- **Modelos por estado existem justamente para o onboarding**: ao contratar um município, inicializar toda a estrutura contábil + orçamentária a partir do modelo do estado. Hoje os técnicos de implantação dão **INSERT por script** no banco — má prática que essa automação substitui.
- Por isso a dupla feature: **importar o modelo do estado** (lado TCE) + **copiar automaticamente na criação da entidade** é o **fluxo de onboarding**, não só conveniência.

## A fazer (backlog — onboarding)
- **Importação do plano por estado (lado TCE)** — FEITO para os três planos (contábil + receita/despesa via importador CSV; fontes via CRUD). 
- **Cópia automática na criação da entidade** — ✅ **JÁ EXISTE** (verificado 2026-06-11): `EntidadeService.criar` copia as 3 árvores + fontes do modelo (município herda do estado) para o exercício informado no form admin ("Exercício (ano)"), em transação, `origem=MODELO`/`modeloContaId`. 23 testes.
- **Abertura de novo exercício p/ entidade EXISTENTE** — ✅ **FEITO (#72, squash `611318f`)**: `AberturaExercicioService.abrir(entidadeId, ano)` + botão/modal em `/admin/entidades` (ano sugerido = último+1; CONFLITO se já aberto → ressincronizar; erro claro se o modelo não tem os planos do ano). Dropdown "Planos" agora lista todos os exercícios. Ciclo completo: criar entidade → abrir exercício → ressincronizar.

## Rastreabilidade execução ↔ contabilidade (Fase 3+)
- Todo lançamento de **execução orçamentária** que for contabilizado precisa de **rastreabilidade bidirecional**: do lançamento orçamentário → ver o que foi lançado na contabilidade; do lançamento contábil → ver de onde veio (origem).
- **Nem todo lançamento contábil vem da execução orçamentária**: haverá **telas de lançamento contábil manual** (futuro). Logo o lançamento contábil tem **origem opcional** (orçamentária OU manual). O elo orçamentário→contábil passa pela **Tabela de Eventos** (deferida).

## Movimentação
- O **saldo orçamentário de cada conta é controlado por fonte de recurso (FR)**. Uma conta de **despesa** orçamentária pode ter **várias FRs**. Idem **receita**: cada conta pode ter várias FRs; o arrecadado também é controlado por fonte.
- Toda movimentação (receita e despesa orçamentária) é **sempre na conta analítica (folha)**, mas o sistema deve **somar o valor em todos os pais (ancestrais) da árvore** — saldo consolidado/roll-up para facilitar consulta.

## Consolidação município × entidade — CONFIRMADO (mensal, sem real-time)
- Lei exige prestação de contas **por entidade E por município**.
- Decisão: saldo **em tempo real só no nível da entidade** (conta analítica × FR, com roll-up nos ancestrais). Consolidação do **município = snapshot mensal** (reaproveitar padrão `ResumoMensalConta`), **não** duplicar a estrutura nem somar em tempo real. Visão intra-mês do município = **cálculo sob demanda** somando as entidades.
- A consolidação do município ocorre no **nível das contas do MODELO** (comuns a todas as entidades); desdobramentos (por entidade) rolam para dentro da conta-modelo-pai, então o município nunca precisa da árvore de desdobramentos.

## Fonte de recurso ↔ contas bancárias
- Cada **fonte de recurso pode ter várias contas bancárias**.
- **Pagamentos por uma FR só podem ser feitos pelas contas bancárias daquela FR.**
- ✅ **FEITO (PR #75, 2026-06-15):** cadastro `ContaBancaria` + trava na emissão de OP. Vínculo conta→fonte **por CÓDIGO** (`fonteCodigo`, não FK à cópia do exercício) p/ sobreviver à virada de ano. A fonte da OP é a da **dotação do empenho** (`liquidação→empenho→dotação→fonteRecurso.codigo`); `OrdensPagamentoService.criar` exige conta da entidade, ATIVA e da mesma fonte. `OrdemPagamento.contaBancariaId` FK nullable (OPs legadas = texto livre). Conta usada em OP não exclui — só inativa.

## Contas bancárias
- Devem seguir o **padrão Febraban**, tanto no **cadastro** (banco, agência, conta) quanto na **movimentação** de débito e crédito. ✅ Cadastro Febraban FEITO no #75 (banco 3 díg./agência+DV/conta+DV); tela `/app/contas-bancarias`.
- **Escopo CONFIRMADO: incluir arquivos CNAB** (remessa/retorno 240/400) — integração bancária real (pagamentos, conciliação, layouts por banco), não só o formato de identificação da conta. ⏳ **CNAB ainda A_FAZER** (fase 2; registrado no `escopo.ts`).

**How to apply:** ao modelar a execução, separar contas-de-modelo (TCE, imutáveis) de desdobramentos-da-entidade; saldo por (conta analítica × FR) com agregação nos ancestrais; entidade `ContaBancaria` (Febraban) ligada à FR, com pagamento restrito às contas da FR. Confirmar com Marco: a dimensão Entidade, onde vivem os desdobramentos, e o escopo "Febraban" (formato de conta vs. arquivos CNAB).
