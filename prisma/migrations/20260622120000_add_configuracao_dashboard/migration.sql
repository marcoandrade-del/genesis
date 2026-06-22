-- CreateEnum
CREATE TYPE "GranularidadePlano" AS ENUM ('PADRAO', 'DESDOBRADO');

-- CreateTable
CREATE TABLE "configuracoes_dashboard" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "granularidadePlano" "GranularidadePlano" NOT NULL DEFAULT 'DESDOBRADO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_dashboard_entidadeId_key" ON "configuracoes_dashboard"("entidadeId");

-- AddForeignKey
ALTER TABLE "configuracoes_dashboard" ADD CONSTRAINT "configuracoes_dashboard_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

