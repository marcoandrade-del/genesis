-- Transferência Financeira Recebida (duodécimo/repasse intra-ente) — aditiva.
-- Novo gatilho/origem para o evento contábil 900 (D Caixa / C VPA 4.5.1.1.2.02)
-- + tabela de origem dos lançamentos (simetria com "arrecacoes").

-- AlterEnum (ADD VALUE não roda dentro de transação — statements autônomos)
ALTER TYPE "GatilhoEvento" ADD VALUE IF NOT EXISTS 'TRANSFERENCIA_FINANCEIRA';
ALTER TYPE "OrigemLancamento" ADD VALUE IF NOT EXISTS 'TRANSFERENCIA_FINANCEIRA';

-- CreateTable
CREATE TABLE "transferencias_financeiras" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "fonteCodigo" TEXT NOT NULL,
    "historico" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transferencias_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transferencias_financeiras_entidadeId_data_idx" ON "transferencias_financeiras"("entidadeId", "data");

-- AddForeignKey
ALTER TABLE "transferencias_financeiras" ADD CONSTRAINT "transferencias_financeiras_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
