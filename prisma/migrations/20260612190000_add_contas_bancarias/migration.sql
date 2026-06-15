-- CreateTable
CREATE TABLE "contas_bancarias" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "fonteCodigo" TEXT NOT NULL,
    "bancoCodigo" TEXT NOT NULL,
    "bancoNome" TEXT,
    "agencia" TEXT NOT NULL,
    "agenciaDv" TEXT,
    "numero" TEXT NOT NULL,
    "numeroDv" TEXT,
    "descricao" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_bancarias_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ordens_pagamento" ADD COLUMN "contaBancariaId" TEXT;

-- CreateIndex
CREATE INDEX "contas_bancarias_entidadeId_fonteCodigo_idx" ON "contas_bancarias"("entidadeId", "fonteCodigo");

-- CreateIndex
CREATE UNIQUE INDEX "contas_bancarias_entidadeId_bancoCodigo_agencia_numero_key" ON "contas_bancarias"("entidadeId", "bancoCodigo", "agencia", "numero");

-- CreateIndex
CREATE INDEX "ordens_pagamento_contaBancariaId_idx" ON "ordens_pagamento"("contaBancariaId");

-- AddForeignKey
ALTER TABLE "contas_bancarias" ADD CONSTRAINT "contas_bancarias_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_pagamento" ADD CONSTRAINT "ordens_pagamento_contaBancariaId_fkey" FOREIGN KEY ("contaBancariaId") REFERENCES "contas_bancarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
