-- CreateEnum
CREATE TYPE "EsferaOrcamentaria" AS ENUM ('FISCAL', 'SEGURIDADE_SOCIAL', 'INVESTIMENTO');

-- AlterTable
ALTER TABLE "dotacoes_despesa" ADD COLUMN "esfera" "EsferaOrcamentaria" NOT NULL DEFAULT 'FISCAL',
ADD COLUMN "vinculoVariavelCodigo" TEXT,
ADD COLUMN "vinculoVariavelNome" TEXT;
