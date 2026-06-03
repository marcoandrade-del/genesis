-- CreateEnum
CREATE TYPE "TipoEmpenho" AS ENUM ('ORDINARIO', 'GLOBAL', 'ESTIMATIVO');

-- CreateEnum
CREATE TYPE "StatusEmpenho" AS ENUM ('ATIVO', 'ANULADO');

-- CreateEnum
CREATE TYPE "StatusLiquidacao" AS ENUM ('ATIVA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusOrdemPagamento" AS ENUM ('EMITIDA', 'PAGA', 'CANCELADA');

-- CreateTable
CREATE TABLE "empenhos" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "dotacaoDespesaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "reservaDotacaoId" TEXT,
    "contratoId" TEXT,
    "ataRegistroPrecoId" TEXT,
    "numero" TEXT NOT NULL,
    "tipo" "TipoEmpenho" NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valor" DECIMAL(18,2) NOT NULL,
    "valorLiquidado" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "historico" TEXT,
    "status" "StatusEmpenho" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empenhos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacoes" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "empenhoId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valor" DECIMAL(18,2) NOT NULL,
    "valorPago" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notaFiscal" TEXT,
    "atesteResponsavel" TEXT,
    "status" "StatusLiquidacao" NOT NULL DEFAULT 'ATIVA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "liquidacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordens_pagamento" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "liquidacaoId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valor" DECIMAL(18,2) NOT NULL,
    "contaBancaria" TEXT NOT NULL,
    "comprovante" TEXT,
    "status" "StatusOrdemPagamento" NOT NULL DEFAULT 'EMITIDA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ordens_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "empenhos_dotacaoDespesaId_idx" ON "empenhos"("dotacaoDespesaId");

-- CreateIndex
CREATE INDEX "empenhos_entidadeId_idx" ON "empenhos"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "empenhos_entidadeId_numero_key" ON "empenhos"("entidadeId", "numero");

-- CreateIndex
CREATE INDEX "liquidacoes_empenhoId_idx" ON "liquidacoes"("empenhoId");

-- CreateIndex
CREATE INDEX "liquidacoes_entidadeId_idx" ON "liquidacoes"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "liquidacoes_entidadeId_numero_key" ON "liquidacoes"("entidadeId", "numero");

-- CreateIndex
CREATE INDEX "ordens_pagamento_liquidacaoId_idx" ON "ordens_pagamento"("liquidacaoId");

-- CreateIndex
CREATE INDEX "ordens_pagamento_entidadeId_idx" ON "ordens_pagamento"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "ordens_pagamento_entidadeId_numero_key" ON "ordens_pagamento"("entidadeId", "numero");

-- AddForeignKey
ALTER TABLE "empenhos" ADD CONSTRAINT "empenhos_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empenhos" ADD CONSTRAINT "empenhos_dotacaoDespesaId_fkey" FOREIGN KEY ("dotacaoDespesaId") REFERENCES "dotacoes_despesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empenhos" ADD CONSTRAINT "empenhos_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empenhos" ADD CONSTRAINT "empenhos_reservaDotacaoId_fkey" FOREIGN KEY ("reservaDotacaoId") REFERENCES "reservas_dotacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empenhos" ADD CONSTRAINT "empenhos_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empenhos" ADD CONSTRAINT "empenhos_ataRegistroPrecoId_fkey" FOREIGN KEY ("ataRegistroPrecoId") REFERENCES "atas_registro_preco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacoes" ADD CONSTRAINT "liquidacoes_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacoes" ADD CONSTRAINT "liquidacoes_empenhoId_fkey" FOREIGN KEY ("empenhoId") REFERENCES "empenhos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_pagamento" ADD CONSTRAINT "ordens_pagamento_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_pagamento" ADD CONSTRAINT "ordens_pagamento_liquidacaoId_fkey" FOREIGN KEY ("liquidacaoId") REFERENCES "liquidacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

