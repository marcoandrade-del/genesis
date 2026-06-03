-- Extensão de RelatorioPersonalizado: query SQL + contexto (entidade) + templates.
-- Campos opcionais para não quebrar a CRUD admin legada de relatórios personalizados.
ALTER TABLE "relatorios_personalizados" ADD COLUMN     "cabecalhoId" TEXT,
ADD COLUMN     "entidadeId" TEXT,
ADD COLUMN     "query" TEXT,
ADD COLUMN     "rodapeId" TEXT;

ALTER TABLE "relatorios_personalizados" ADD CONSTRAINT "relatorios_personalizados_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "relatorios_personalizados" ADD CONSTRAINT "relatorios_personalizados_cabecalhoId_fkey" FOREIGN KEY ("cabecalhoId") REFERENCES "cabecalhos_relatorio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "relatorios_personalizados" ADD CONSTRAINT "relatorios_personalizados_rodapeId_fkey" FOREIGN KEY ("rodapeId") REFERENCES "rodapes_relatorio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- Views de relatório (sandbox): cada uma JÁ filtra pela entidade da sessão, lida
-- de `current_setting('app.entidade')` (definido por transação no executor). O
-- segundo argumento `true` faz a função devolver NULL se a GUC não estiver
-- setada — e `coluna = NULL` não casa nada, então sem contexto = zero linhas
-- (fail-safe). O isolamento por entidade é garantido AQUI; a role read-only do
-- relatório recebe SELECT apenas nestas views (nunca nas tabelas-base).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW rel_lancamentos AS
SELECT l.id, l."data", l.historico, l.valor
FROM lancamentos l
WHERE l."entidadeId" = current_setting('app.entidade', true);

CREATE OR REPLACE VIEW rel_contas_contabeis AS
SELECT c.id, c.ano, c.codigo, c.descricao, c.nivel, c."admiteMovimento" AS admite_movimento
FROM contas_contabil_entidade c
WHERE c."entidadeId" = current_setting('app.entidade', true);

CREATE OR REPLACE VIEW rel_orcamento_dotacoes AS
SELECT o.ano,
       uo.codigo    AS unidade_orcamentaria,
       f.codigo     AS funcao,
       sf.codigo    AS subfuncao,
       p.codigo     AS programa,
       a.codigo     AS acao,
       cd.codigo    AS conta_despesa,
       cd.descricao AS conta_despesa_descricao,
       fr.codigo    AS fonte_recurso,
       d."valorAutorizado" AS valor_autorizado,
       d."valorReservado"  AS valor_reservado,
       d."valorEmpenhado"  AS valor_empenhado
FROM dotacoes_despesa d
JOIN orcamentos o               ON o.id = d."orcamentoId"
JOIN unidades_orcamentarias uo  ON uo.id = d."unidadeOrcamentariaId"
JOIN funcoes f                  ON f.id = d."funcaoId"
JOIN subfuncoes sf              ON sf.id = d."subfuncaoId"
JOIN programas p                ON p.id = d."programaId"
JOIN acoes a                    ON a.id = d."acaoId"
JOIN contas_despesa_entidade cd ON cd.id = d."contaDespesaEntidadeId"
JOIN fontes_recurso_entidade fr ON fr.id = d."fonteRecursoEntidadeId"
WHERE o."entidadeId" = current_setting('app.entidade', true);

CREATE OR REPLACE VIEW rel_orcamento_previsoes AS
SELECT o.ano,
       cr.codigo    AS conta_receita,
       cr.descricao AS conta_receita_descricao,
       fr.codigo    AS fonte_recurso,
       pr."valorPrevisto" AS valor_previsto
FROM previsoes_receita pr
JOIN orcamentos o               ON o.id = pr."orcamentoId"
JOIN contas_receita_entidade cr ON cr.id = pr."contaReceitaEntidadeId"
JOIN fontes_recurso_entidade fr ON fr.id = pr."fonteRecursoEntidadeId"
WHERE o."entidadeId" = current_setting('app.entidade', true);
