-- CreateEnum
CREATE TYPE "ArrecadacaoTipo" AS ENUM ('ARRECADACAO', 'ESTORNO');

-- AlterTable
ALTER TABLE "previsoes_receita" ADD COLUMN "valorArrecadado" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "arrecadacoes" (
    "id" TEXT NOT NULL,
    "previsaoId" TEXT NOT NULL,
    "tipo" "ArrecadacaoTipo" NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "historico" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arrecadacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "arrecadacoes_previsaoId_idx" ON "arrecadacoes"("previsaoId");

-- AddForeignKey
ALTER TABLE "arrecadacoes" ADD CONSTRAINT "arrecadacoes_previsaoId_fkey" FOREIGN KEY ("previsaoId") REFERENCES "previsoes_receita"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
