-- AlterTable
ALTER TABLE "empenhos" ADD COLUMN "subElementoContaId" TEXT;

-- CreateIndex
CREATE INDEX "empenhos_subElementoContaId_idx" ON "empenhos"("subElementoContaId");

-- AddForeignKey
ALTER TABLE "empenhos" ADD CONSTRAINT "empenhos_subElementoContaId_fkey" FOREIGN KEY ("subElementoContaId") REFERENCES "contas_despesa_entidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
