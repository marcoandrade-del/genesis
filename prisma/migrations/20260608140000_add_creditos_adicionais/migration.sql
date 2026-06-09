-- CreateEnum
CREATE TYPE "CreditoAdicionalTipo" AS ENUM ('SUPLEMENTAR', 'ESPECIAL', 'EXTRAORDINARIO');

-- CreateEnum
CREATE TYPE "CreditoOperacao" AS ENUM ('REFORCO', 'ANULACAO');

-- CreateTable
CREATE TABLE "creditos_adicionais" (
    "id" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "tipo" "CreditoAdicionalTipo" NOT NULL,
    "numero" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "atoLegal" TEXT NOT NULL,
    "justificativa" TEXT,
    "valorTotal" DECIMAL(18,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creditos_adicionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creditos_adicionais_itens" (
    "id" TEXT NOT NULL,
    "creditoAdicionalId" TEXT NOT NULL,
    "dotacaoDespesaId" TEXT NOT NULL,
    "operacao" "CreditoOperacao" NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "creditos_adicionais_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creditos_adicionais_orcamentoId_idx" ON "creditos_adicionais"("orcamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "creditos_adicionais_orcamentoId_numero_key" ON "creditos_adicionais"("orcamentoId", "numero");

-- CreateIndex
CREATE INDEX "creditos_adicionais_itens_creditoAdicionalId_idx" ON "creditos_adicionais_itens"("creditoAdicionalId");

-- AddForeignKey
ALTER TABLE "creditos_adicionais" ADD CONSTRAINT "creditos_adicionais_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creditos_adicionais_itens" ADD CONSTRAINT "creditos_adicionais_itens_creditoAdicionalId_fkey" FOREIGN KEY ("creditoAdicionalId") REFERENCES "creditos_adicionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creditos_adicionais_itens" ADD CONSTRAINT "creditos_adicionais_itens_dotacaoDespesaId_fkey" FOREIGN KEY ("dotacaoDespesaId") REFERENCES "dotacoes_despesa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
