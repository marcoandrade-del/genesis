-- CreateEnum
CREATE TYPE "TipoSincronizacaoPortal" AS ENUM ('ARRECADACAO', 'DESPESA_EXECUCAO', 'DECRETOS');

-- CreateEnum
CREATE TYPE "StatusSincronizacaoPortal" AS ENUM ('OK', 'DIVERGENTE', 'ERRO');

-- CreateTable
CREATE TABLE "sincronizacoes_portal" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "tipo" "TipoSincronizacaoPortal" NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "status" "StatusSincronizacaoPortal" NOT NULL,
    "mensagem" TEXT,
    "valorPortal" DECIMAL(18,2),
    "valorGravado" DECIMAL(18,2),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sincronizacoes_portal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sincronizacoes_portal_entidadeId_tipo_ano_mes_idx" ON "sincronizacoes_portal"("entidadeId", "tipo", "ano", "mes");

-- AddForeignKey
ALTER TABLE "sincronizacoes_portal" ADD CONSTRAINT "sincronizacoes_portal_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
