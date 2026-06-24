-- AlterEnum
ALTER TYPE "StatusOrcamento" ADD VALUE 'ENVIADO_AO_LEGISLATIVO' AFTER 'RASCUNHO';
ALTER TYPE "StatusOrcamento" ADD VALUE 'PUBLICADO' AFTER 'APROVADO';

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN "dataPublicacao" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "transicoes_status_orcamento" (
    "id" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "de" "StatusOrcamento" NOT NULL,
    "para" "StatusOrcamento" NOT NULL,
    "autorId" TEXT NOT NULL,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transicoes_status_orcamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transicoes_status_orcamento_orcamentoId_idx" ON "transicoes_status_orcamento"("orcamentoId");

-- AddForeignKey
ALTER TABLE "transicoes_status_orcamento" ADD CONSTRAINT "transicoes_status_orcamento_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transicoes_status_orcamento" ADD CONSTRAINT "transicoes_status_orcamento_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
