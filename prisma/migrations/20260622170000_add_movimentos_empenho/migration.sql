-- CreateEnum
CREATE TYPE "TipoMovimentoEmpenho" AS ENUM ('EMPENHO', 'ESTORNO_EMPENHO', 'LIQUIDACAO', 'ESTORNO_LIQUIDACAO', 'PAGAMENTO', 'ESTORNO_PAGAMENTO');

-- CreateTable
CREATE TABLE "movimentos_empenho" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "empenhoId" TEXT NOT NULL,
    "tipo" "TipoMovimentoEmpenho" NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "data" DATE NOT NULL,
    "liquidacaoId" TEXT,
    "ordemPagamentoId" TEXT,
    "historico" TEXT,
    "documento" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "movimentos_empenho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimentos_empenho_empenhoId_idx" ON "movimentos_empenho"("empenhoId");

-- CreateIndex
CREATE INDEX "movimentos_empenho_liquidacaoId_idx" ON "movimentos_empenho"("liquidacaoId");

-- CreateIndex
CREATE INDEX "movimentos_empenho_ordemPagamentoId_idx" ON "movimentos_empenho"("ordemPagamentoId");

-- CreateIndex
CREATE INDEX "movimentos_empenho_entidadeId_data_idx" ON "movimentos_empenho"("entidadeId", "data");

-- AddForeignKey
ALTER TABLE "movimentos_empenho" ADD CONSTRAINT "movimentos_empenho_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_empenho" ADD CONSTRAINT "movimentos_empenho_empenhoId_fkey" FOREIGN KEY ("empenhoId") REFERENCES "empenhos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_empenho" ADD CONSTRAINT "movimentos_empenho_liquidacaoId_fkey" FOREIGN KEY ("liquidacaoId") REFERENCES "liquidacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_empenho" ADD CONSTRAINT "movimentos_empenho_ordemPagamentoId_fkey" FOREIGN KEY ("ordemPagamentoId") REFERENCES "ordens_pagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
