-- CreateEnum
CREATE TYPE "CategoriaDivida" AS ENUM ('MOBILIARIA', 'CONTRATUAL', 'PRECATORIOS', 'DEMAIS');

-- CreateEnum
CREATE TYPE "TipoGarantia" AS ENUM ('INTERNA', 'EXTERNA');

-- CreateEnum
CREATE TYPE "TipoOperacaoCredito" AS ENUM ('MOBILIARIA', 'CONTRATUAL_INTERNA', 'CONTRATUAL_EXTERNA', 'ARO', 'REESTRUTURACAO', 'DEMAIS_NAO_SUJEITAS');

-- CreateTable
CREATE TABLE "divida_itens" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "categoria" "CategoriaDivida" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorSaldo" DECIMAL(18,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "divida_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garantias" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "tipo" "TipoGarantia" NOT NULL,
    "beneficiario" TEXT NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "contragarantia" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "garantias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operacoes_credito" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "tipo" "TipoOperacaoCredito" NOT NULL,
    "credor" TEXT NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "data" DATE NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operacoes_credito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "divida_itens_entidadeId_ano_idx" ON "divida_itens"("entidadeId", "ano");

-- CreateIndex
CREATE INDEX "garantias_entidadeId_ano_idx" ON "garantias"("entidadeId", "ano");

-- CreateIndex
CREATE INDEX "operacoes_credito_entidadeId_ano_idx" ON "operacoes_credito"("entidadeId", "ano");

-- AddForeignKey
ALTER TABLE "divida_itens" ADD CONSTRAINT "divida_itens_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garantias" ADD CONSTRAINT "garantias_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operacoes_credito" ADD CONSTRAINT "operacoes_credito_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
