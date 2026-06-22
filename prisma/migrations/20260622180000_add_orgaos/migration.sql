-- CreateTable
CREATE TABLE "orgaos" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orgaos_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "unidades_orcamentarias" ADD COLUMN "orgaoId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orgaos_entidadeId_codigo_key" ON "orgaos"("entidadeId", "codigo");

-- CreateIndex
CREATE INDEX "orgaos_entidadeId_idx" ON "orgaos"("entidadeId");

-- CreateIndex
CREATE INDEX "unidades_orcamentarias_orgaoId_idx" ON "unidades_orcamentarias"("orgaoId");

-- AddForeignKey
ALTER TABLE "orgaos" ADD CONSTRAINT "orgaos_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_orcamentarias" ADD CONSTRAINT "unidades_orcamentarias_orgaoId_fkey" FOREIGN KEY ("orgaoId") REFERENCES "orgaos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
