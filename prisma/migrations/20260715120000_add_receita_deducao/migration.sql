-- Dedução da receita (ex.: FUNDEB) — aditiva.
-- Previsão: dedução prevista por trás do valorPrevisto (que segue LÍQUIDO).
-- Movimento: novo tipo DEDUCAO (parcela deduzida na origem) + materializado.
-- Evento: novo gatilho DEDUCAO na tabela de eventos.

-- AlterEnum
ALTER TYPE "GatilhoEvento" ADD VALUE IF NOT EXISTS 'DEDUCAO';

-- AlterEnum
ALTER TYPE "ArrecadacaoTipo" ADD VALUE IF NOT EXISTS 'DEDUCAO';

-- AlterTable
ALTER TABLE "previsoes_receita" ADD COLUMN "valorDeducaoPrevisto" DECIMAL(18,2) NOT NULL DEFAULT 0,
                                ADD COLUMN "valorDeduzido" DECIMAL(18,2) NOT NULL DEFAULT 0;
