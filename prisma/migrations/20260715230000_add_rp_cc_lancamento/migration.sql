-- Restos a Pagar (RP) — aditiva.
-- cc de despesa CRUA no LancamentoItem (RP não tem dotação do ano) + nova origem.

-- AlterEnum
ALTER TYPE "OrigemLancamento" ADD VALUE IF NOT EXISTS 'RESTOS_A_PAGAR';

-- AlterTable
ALTER TABLE "lancamento_itens" ADD COLUMN "funcaoCodigo" TEXT,
                               ADD COLUMN "subfuncaoCodigo" TEXT,
                               ADD COLUMN "naturezaDespesaCodigo" TEXT;
