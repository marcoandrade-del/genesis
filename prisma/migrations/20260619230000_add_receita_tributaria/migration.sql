-- CreateEnum
CREATE TYPE "IndicadorReconhecimento" AS ENUM ('CAIXA', 'COMPETENCIA');

-- AlterEnum
ALTER TYPE "OrigemLancamento" ADD VALUE 'LANCAMENTO_TRIBUTARIO';

-- AlterTable
ALTER TABLE "parametros_receita" ADD COLUMN     "contaAtivoCodigo" TEXT,
ADD COLUMN     "indicadorReconhecimento" "IndicadorReconhecimento" NOT NULL DEFAULT 'CAIXA';

-- CreateTable
CREATE TABLE "lancamentos_tributarios" (
    "id" TEXT NOT NULL,
    "previsaoId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "vencimento" DATE,
    "devedorNome" TEXT,
    "devedorDocumento" TEXT,
    "documento" TEXT,
    "historico" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "lancamentos_tributarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lancamentos_tributarios_previsaoId_idx" ON "lancamentos_tributarios"("previsaoId");

-- AddForeignKey
ALTER TABLE "lancamentos_tributarios" ADD CONSTRAINT "lancamentos_tributarios_previsaoId_fkey" FOREIGN KEY ("previsaoId") REFERENCES "previsoes_receita"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

