-- Tipo da dedução (FUNDEB/RENUNCIA/OUTRAS) nos movimentos DEDUCAO — decide o
-- evento contábil (150/151/152). Aditiva; null = legado (FUNDEB).
CREATE TYPE "DeducaoTipo" AS ENUM ('FUNDEB', 'RENUNCIA', 'OUTRAS');

ALTER TABLE "arrecadacoes" ADD COLUMN "deducaoTipo" "DeducaoTipo";
