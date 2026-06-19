-- AlterTable
ALTER TABLE "arrecadacoes" ADD COLUMN     "contaBancariaId" TEXT;

-- AlterTable
ALTER TABLE "contas_bancarias" ADD COLUMN     "contaContabilCodigo" TEXT;

-- AddForeignKey
ALTER TABLE "arrecadacoes" ADD CONSTRAINT "arrecadacoes_contaBancariaId_fkey" FOREIGN KEY ("contaBancariaId") REFERENCES "contas_bancarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

