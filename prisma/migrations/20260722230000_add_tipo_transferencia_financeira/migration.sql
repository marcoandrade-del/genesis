-- CreateEnum
CREATE TYPE "TipoTransferenciaFinanceira" AS ENUM ('RECEBIDA', 'CONCEDIDA');

-- AlterTable
ALTER TABLE "transferencias_financeiras" ADD COLUMN "tipo" "TipoTransferenciaFinanceira" NOT NULL DEFAULT 'RECEBIDA';
