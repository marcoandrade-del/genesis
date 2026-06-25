---
name: compras-no-app-plano
description: "Plano para trazer o módulo Compras (L14.133) para a área do operador /app, escopado ao contexto entidade+exercício; reusa os services existentes"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7542ce95-c63e-418e-b797-cdff6fa00d54
---

**Objetivo:** módulo Compras na área do operador `/app` (não no `/admin`), escopado ao `req.contexto` (entidade+exercício do cookie `genesis_exercicio`), reusando os services de compras já existentes. Pedido do Marco (2026-06-03): usuário comum acessa orçamento/contabilidade/compras/relatórios numa casa separada do admin.

**Padrão a seguir = `/app/orcamento`** (ver `src/app/orcamento.ts` + `src/app/index.ts`):
- Novas rotas `src/app/compras*.ts`, registradas no escopo autenticado de `src/app/index.ts` (após `appAuthMiddleware`+`appContextoMiddleware`).
- Cada handler lê `req.contexto.{entidadeId, ano, nivel}`, chama o service (já entidade-scoped), renderiza `src/views/app/compras/*.ejs`. SEM picker de entidade (≠ /admin, que usa estado→município→entidade por querystring).
- Extrair um partial de navbar/context-bar do /app (hoje `dashboard.ejs`/`orcamento.ejs` duplicam a barra com "Trocar contexto"/"Sair") p/ não repetir em ~11 telas.

**Services reusados (NÃO reescrever regra de negócio — as 5 regras críticas já estão neles):**
- Globais: `ItensCatalogoService`, `FornecedoresService`.
- Entidade×ano: `PlanosContratacaoService` (PCA), `DocumentosDemandaService` (DOD/TR).
- Entidade: `ReservasDotacaoService`, `ProcessosService`, `ContratosService`, `AtasRegistroPrecoService`, `EmpenhosService`, `LiquidacoesService`, `OrdensPagamentoService`.

**Permissão (`nivel` do AcessoEntidade):** LEITURA = read-only (esconder ações + barrar POST server-side); ESCRITA/ADMIN = cria/edita/cancela. Dashboard deve mostrar o card Compras só p/ quem tem acesso à entidade (já é o caso — todo acesso vê as áreas).

**Nuance do exercício (ano):** PCA/DOD/Processo têm `ano`; reserva amarra em dotação (orçamento do ano); contrato/ata/empenho/liquidação/OP NÃO têm `ano` explícito (amarram em dotação/processo). Decidir com Marco: filtrar listagens por ano via vínculo, ou listar tudo da entidade marcando o exercício. Proposta inicial: listar por entidade, sem filtro rígido por ano.

**Faseamento (PRs reviewáveis, espelha a stack admin):**
- **C-App-1** ✅ FEITO — **#45 mergeado em master (5ccdf23)**. Card Compras no dashboard; hub `/app/compras` + telas read-only de Catálogo, PCA, DOD/TR, Reservas. Bônus: `ItensCatalogoService.contar()/listarPaginado()` + busca/paginação no catálogo (/app E /admin), pois o CATMAT (162.919 itens) foi importado no banco dev. Próxima sessão começa no C-App-2.
- **C-App-2 + C-App-3** ✅ FEITO **read-only** — **#59 mergeado em master (be8fb12)**. Marco decidiu SÓ LEITURA (não escrita) e 1 PR único. 7 telas GET em `src/app/compras.ts` reusando só `listar` dos services: Seleção (fornecedores[global]/processos/contratos/atas) + Execução (empenhos/liquidações/ordens-pagamento), escopadas por `req.contexto.entidadeId`. Hub `compras.ejs` reorganizado em 3 fases. Views `src/views/app/compras-{fornecedores,processos,contratos,atas,empenhos,liquidacoes,ordens-pagamento}.ejs`. +9 testes. Criação/edição continua só no /admin.

**Fora de escopo:** `/admin` (continua p/ admin do sistema); schema/migrations (ZERO — tabelas já existem); regras de negócio (prontas).

**Testes:** unit das rotas (mock prisma, estilo `src/app/__tests__/`), cobrindo gate de permissão (LEITURA não escreve) e escopo de contexto (usa entidade do cookie, não querystring).

**Coordenação:** começar SÓ após **#42 (R1 Relatórios) mergear** — estabiliza `src/app/index.ts`, `dashboard.ejs`, `prisma-mock.ts` (zonas que o R1 também toca). Branch nova a partir do master pós-#42. Ver [[coordenacao-sessoes]], [[compras-modulo-plano]], [[relatorios-gerador-plano]].
