-- CreateEnum
CREATE TYPE "TipoMetaFiscal" AS ENUM ('RECEITA_TOTAL', 'DESPESA_TOTAL', 'RESULTADO_PRIMARIO', 'RESULTADO_NOMINAL', 'DIVIDA_CONSOLIDADA_LIQUIDA');

-- CreateTable
CREATE TABLE "metas_fiscais" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "tipo" "TipoMetaFiscal" NOT NULL,
    "valorMeta" DECIMAL(18,2) NOT NULL,
    "exercicioReferencia" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metas_fiscais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metas_fiscais_entidadeId_ano_tipo_key" ON "metas_fiscais"("entidadeId", "ano", "tipo");

-- AddForeignKey
ALTER TABLE "metas_fiscais" ADD CONSTRAINT "metas_fiscais_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
