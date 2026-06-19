-- CreateEnum
CREATE TYPE "OrigemImportExtrato" AS ENUM ('MANUAL', 'CSV', 'OFX', 'CNAB');

-- CreateTable
CREATE TABLE "movimentos_bancarios" (
    "id" TEXT NOT NULL,
    "contaBancariaId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "sentido" "TipoLancamento" NOT NULL,
    "historico" TEXT,
    "documento" TEXT,
    "origemImport" "OrigemImportExtrato" NOT NULL DEFAULT 'MANUAL',
    "loteImport" TEXT,
    "arrecadacaoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_bancarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimentos_bancarios_contaBancariaId_data_idx" ON "movimentos_bancarios"("contaBancariaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "movimentos_bancarios_arrecadacaoId_key" ON "movimentos_bancarios"("arrecadacaoId");

-- AddForeignKey
ALTER TABLE "movimentos_bancarios" ADD CONSTRAINT "movimentos_bancarios_contaBancariaId_fkey" FOREIGN KEY ("contaBancariaId") REFERENCES "contas_bancarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_bancarios" ADD CONSTRAINT "movimentos_bancarios_arrecadacaoId_fkey" FOREIGN KEY ("arrecadacaoId") REFERENCES "arrecadacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

