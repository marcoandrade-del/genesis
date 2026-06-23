-- CreateTable
CREATE TABLE "movimentos_diarios_conta" (
    "entidadeId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "totalDebito" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCredito" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "movimentos_diarios_conta_pkey" PRIMARY KEY ("entidadeId","contaId","data")
);

-- CreateIndex
CREATE INDEX "movimentos_diarios_conta_entidadeId_data_idx" ON "movimentos_diarios_conta"("entidadeId", "data");

-- AddForeignKey
ALTER TABLE "movimentos_diarios_conta" ADD CONSTRAINT "movimentos_diarios_conta_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_diarios_conta" ADD CONSTRAINT "movimentos_diarios_conta_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas_contabil_entidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
