-- CreateTable
CREATE TABLE "preferencias_relatorio_plano" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "relatorio" TEXT NOT NULL,
    "granularidadePlano" "GranularidadePlano" NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preferencias_relatorio_plano_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "preferencias_relatorio_plano_entidadeId_relatorio_key" ON "preferencias_relatorio_plano"("entidadeId", "relatorio");

