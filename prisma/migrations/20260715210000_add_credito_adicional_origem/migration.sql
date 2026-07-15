-- Espelho contábil dos créditos adicionais (decretos) — aditiva.
-- Nova origem de lançamento p/ os eventos de crédito adicional no razão
-- (segregação da dotação inicial vs. crédito por tipo, mantendo 6.2.2.1.1).

-- AlterEnum
ALTER TYPE "OrigemLancamento" ADD VALUE IF NOT EXISTS 'CREDITO_ADICIONAL';
