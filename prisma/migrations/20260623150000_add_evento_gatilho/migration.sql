-- CreateEnum
CREATE TYPE "GatilhoEvento" AS ENUM ('ARRECADACAO', 'EMPENHO', 'LIQUIDACAO', 'PAGAMENTO');

-- AlterTable
ALTER TABLE "eventos_contabeis" ADD COLUMN "gatilho" "GatilhoEvento";

-- CreateIndex
CREATE INDEX "eventos_contabeis_modeloContabilId_gatilho_idx" ON "eventos_contabeis"("modeloContabilId", "gatilho");
