-- CreateTable
CREATE TABLE "parametros_despesa" (
    "id" TEXT NOT NULL,
    "modeloContabilId" TEXT NOT NULL,
    "naturezaCodigo" TEXT NOT NULL,
    "contaVpdCodigo" TEXT NOT NULL,
    "contaPassivoCodigo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parametros_despesa_modeloContabilId_naturezaCodigo_key" ON "parametros_despesa"("modeloContabilId", "naturezaCodigo");

-- CreateIndex
CREATE INDEX "parametros_despesa_modeloContabilId_idx" ON "parametros_despesa"("modeloContabilId");

-- AddForeignKey
ALTER TABLE "parametros_despesa" ADD CONSTRAINT "parametros_despesa_modeloContabilId_fkey" FOREIGN KEY ("modeloContabilId") REFERENCES "modelos_contabeis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
