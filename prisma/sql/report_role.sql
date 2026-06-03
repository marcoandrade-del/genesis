-- Setup da role somente-leitura do Gerador de Relatórios (rodar uma vez por ambiente).
--
-- O isolamento por entidade é garantido pelas views `rel_*` (que filtram por
-- current_setting('app.entidade')). Esta role só enxerga essas views — nunca as
-- tabelas-base — então o operador não tem como ler dados de outra entidade nem
-- escrever. O executor (src/services/relatorio-executor.ts) conecta com esta role
-- via REPORT_DB_URL, abre transação READ ONLY e seta app.entidade por transação.
--
-- Ajuste a senha e rode como superusuário/owner do banco:
--   psql "$DATABASE_URL" -f prisma/sql/report_role.sql

-- 1) A role (login). Troque a senha.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genesis_report_ro') THEN
    CREATE ROLE genesis_report_ro LOGIN PASSWORD 'troque-esta-senha';
  END IF;
END $$;

-- 2) Pode conectar e enxergar o schema, mas nada além das views liberadas.
GRANT CONNECT ON DATABASE genesis TO genesis_report_ro;
GRANT USAGE ON SCHEMA public TO genesis_report_ro;

-- 3) Garante que NÃO tem acesso herdado às tabelas-base (defesa extra).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM genesis_report_ro;

-- 4) SELECT apenas nas views de relatório (já filtradas por entidade).
GRANT SELECT ON
  rel_lancamentos,
  rel_contas_contabeis,
  rel_orcamento_dotacoes,
  rel_orcamento_previsoes
TO genesis_report_ro;

-- Ao adicionar novas views rel_*, lembre de concedê-las aqui também.
