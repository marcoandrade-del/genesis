-- CreateTable
CREATE TABLE "eventos_contabeis" (
    "id" TEXT NOT NULL,
    "modeloContabilId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipoInscricao" TEXT,
    "classificacaoContabilMascara" TEXT,
    "classificacaoOrcamentariaMascara" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eventos_contabeis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_lancamentos" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "contaDebitoMascara" TEXT NOT NULL,
    "contaCreditoMascara" TEXT NOT NULL,

    CONSTRAINT "eventos_lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eventos_contabeis_modeloContabilId_idx" ON "eventos_contabeis"("modeloContabilId");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_contabeis_modeloContabilId_codigo_key" ON "eventos_contabeis"("modeloContabilId", "codigo");

-- CreateIndex
CREATE INDEX "eventos_lancamentos_eventoId_ordem_idx" ON "eventos_lancamentos"("eventoId", "ordem");

-- AddForeignKey
ALTER TABLE "eventos_contabeis" ADD CONSTRAINT "eventos_contabeis_modeloContabilId_fkey" FOREIGN KEY ("modeloContabilId") REFERENCES "modelos_contabeis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_lancamentos" ADD CONSTRAINT "eventos_lancamentos_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "eventos_contabeis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
