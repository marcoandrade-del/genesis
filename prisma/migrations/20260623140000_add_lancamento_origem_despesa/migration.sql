-- AlterEnum
ALTER TYPE "OrigemLancamento" ADD VALUE 'EMPENHO';
ALTER TYPE "OrigemLancamento" ADD VALUE 'LIQUIDACAO';
ALTER TYPE "OrigemLancamento" ADD VALUE 'PAGAMENTO';

-- AlterTable
ALTER TABLE "lancamento_itens" ADD COLUMN "dotacaoDespesaId" TEXT;

-- CreateIndex
CREATE INDEX "lancamento_itens_dotacaoDespesaId_idx" ON "lancamento_itens"("dotacaoDespesaId");

-- AddForeignKey
ALTER TABLE "lancamento_itens" ADD CONSTRAINT "lancamento_itens_dotacaoDespesaId_fkey" FOREIGN KEY ("dotacaoDespesaId") REFERENCES "dotacoes_despesa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
