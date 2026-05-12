-- AlterTable
ALTER TABLE "itens_funcionalidade" ADD COLUMN "referenciaId" TEXT;

-- AddForeignKey
ALTER TABLE "itens_funcionalidade" ADD CONSTRAINT "itens_funcionalidade_referenciaId_fkey" FOREIGN KEY ("referenciaId") REFERENCES "itens_funcionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
