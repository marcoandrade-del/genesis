-- CreateEnum
CREATE TYPE "OrigemLancamento" AS ENUM ('ARRECADACAO');

-- CreateEnum
CREATE TYPE "TipoMutacao" AS ENUM ('EFETIVA', 'NAO_EFETIVA');

-- AlterTable
ALTER TABLE "lancamento_itens" ADD COLUMN     "fonteCodigo" TEXT,
ADD COLUMN     "naturezaReceitaCodigo" TEXT;

-- AlterTable
ALTER TABLE "lancamentos" ADD COLUMN     "eventoCodigo" TEXT,
ADD COLUMN     "origemId" TEXT,
ADD COLUMN     "origemTipo" "OrigemLancamento";

-- CreateTable
CREATE TABLE "parametros_receita" (
    "id" TEXT NOT NULL,
    "modeloContabilId" TEXT NOT NULL,
    "naturezaCodigo" TEXT NOT NULL,
    "tipoMutacao" "TipoMutacao" NOT NULL,
    "contaVpaCodigo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_receita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parametros_receita_modeloContabilId_idx" ON "parametros_receita"("modeloContabilId");

-- CreateIndex
CREATE UNIQUE INDEX "parametros_receita_modeloContabilId_naturezaCodigo_key" ON "parametros_receita"("modeloContabilId", "naturezaCodigo");

-- CreateIndex
CREATE INDEX "lancamentos_origemTipo_origemId_idx" ON "lancamentos"("origemTipo", "origemId");

-- AddForeignKey
ALTER TABLE "parametros_receita" ADD CONSTRAINT "parametros_receita_modeloContabilId_fkey" FOREIGN KEY ("modeloContabilId") REFERENCES "modelos_contabeis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

