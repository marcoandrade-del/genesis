-- CreateEnum
CREATE TYPE "TipoItemCatalogo" AS ENUM ('MATERIAL', 'SERVICO');

-- CreateEnum
CREATE TYPE "StatusPca" AS ENUM ('RASCUNHO', 'APROVADO');

-- CreateEnum
CREATE TYPE "StatusDemanda" AS ENUM ('RASCUNHO', 'AGUARDANDO_PARECER', 'APROVADA', 'REPROVADA');

-- CreateEnum
CREATE TYPE "StatusReserva" AS ENUM ('ATIVA', 'BAIXADA', 'CANCELADA');

-- AlterTable
ALTER TABLE "dotacoes_despesa" ADD COLUMN     "valorEmpenhado" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "valorReservado" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "itens_catalogo" (
    "id" TEXT NOT NULL,
    "tipo" "TipoItemCatalogo" NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "unidadeMedida" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planos_contratacao_anual" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "status" "StatusPca" NOT NULL DEFAULT 'RASCUNHO',
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planos_contratacao_anual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_pca" (
    "id" TEXT NOT NULL,
    "pcaId" TEXT NOT NULL,
    "itemCatalogoId" TEXT NOT NULL,
    "quantidadeEstimada" DECIMAL(18,4) NOT NULL,
    "valorUnitarioEstimado" DECIMAL(18,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_pca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_demanda" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "unidadeOrcamentariaId" TEXT NOT NULL,
    "pcaId" TEXT,
    "justificativa" TEXT NOT NULL,
    "status" "StatusDemanda" NOT NULL DEFAULT 'RASCUNHO',
    "parecerData" TIMESTAMP(3),
    "parecerResponsavel" TEXT,
    "parecerObservacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_demanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_demanda" (
    "id" TEXT NOT NULL,
    "documentoDemandaId" TEXT NOT NULL,
    "itemCatalogoId" TEXT NOT NULL,
    "quantidade" DECIMAL(18,4) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_demanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "termos_referencia" (
    "id" TEXT NOT NULL,
    "documentoDemandaId" TEXT NOT NULL,
    "objeto" TEXT NOT NULL,
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "termos_referencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_termo_referencia" (
    "id" TEXT NOT NULL,
    "termoReferenciaId" TEXT NOT NULL,
    "itemCatalogoId" TEXT NOT NULL,
    "quantidade" DECIMAL(18,4) NOT NULL,
    "precoUnitarioEstimado" DECIMAL(18,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_termo_referencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservas_dotacao" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "dotacaoDespesaId" TEXT NOT NULL,
    "termoReferenciaId" TEXT,
    "numero" TEXT NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "status" "StatusReserva" NOT NULL DEFAULT 'ATIVA',
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservas_dotacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "itens_catalogo_tipo_idx" ON "itens_catalogo"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "itens_catalogo_tipo_codigo_key" ON "itens_catalogo"("tipo", "codigo");

-- CreateIndex
CREATE INDEX "planos_contratacao_anual_entidadeId_idx" ON "planos_contratacao_anual"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "planos_contratacao_anual_entidadeId_ano_key" ON "planos_contratacao_anual"("entidadeId", "ano");

-- CreateIndex
CREATE INDEX "itens_pca_pcaId_idx" ON "itens_pca"("pcaId");

-- CreateIndex
CREATE UNIQUE INDEX "itens_pca_pcaId_itemCatalogoId_key" ON "itens_pca"("pcaId", "itemCatalogoId");

-- CreateIndex
CREATE INDEX "documentos_demanda_entidadeId_ano_idx" ON "documentos_demanda"("entidadeId", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "documentos_demanda_entidadeId_ano_numero_key" ON "documentos_demanda"("entidadeId", "ano", "numero");

-- CreateIndex
CREATE INDEX "itens_demanda_documentoDemandaId_idx" ON "itens_demanda"("documentoDemandaId");

-- CreateIndex
CREATE UNIQUE INDEX "itens_demanda_documentoDemandaId_itemCatalogoId_key" ON "itens_demanda"("documentoDemandaId", "itemCatalogoId");

-- CreateIndex
CREATE UNIQUE INDEX "termos_referencia_documentoDemandaId_key" ON "termos_referencia"("documentoDemandaId");

-- CreateIndex
CREATE INDEX "itens_termo_referencia_termoReferenciaId_idx" ON "itens_termo_referencia"("termoReferenciaId");

-- CreateIndex
CREATE UNIQUE INDEX "itens_termo_referencia_termoReferenciaId_itemCatalogoId_key" ON "itens_termo_referencia"("termoReferenciaId", "itemCatalogoId");

-- CreateIndex
CREATE INDEX "reservas_dotacao_dotacaoDespesaId_idx" ON "reservas_dotacao"("dotacaoDespesaId");

-- CreateIndex
CREATE INDEX "reservas_dotacao_entidadeId_idx" ON "reservas_dotacao"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "reservas_dotacao_entidadeId_numero_key" ON "reservas_dotacao"("entidadeId", "numero");

-- AddForeignKey
ALTER TABLE "planos_contratacao_anual" ADD CONSTRAINT "planos_contratacao_anual_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_pca" ADD CONSTRAINT "itens_pca_pcaId_fkey" FOREIGN KEY ("pcaId") REFERENCES "planos_contratacao_anual"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_pca" ADD CONSTRAINT "itens_pca_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "itens_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_demanda" ADD CONSTRAINT "documentos_demanda_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_demanda" ADD CONSTRAINT "documentos_demanda_unidadeOrcamentariaId_fkey" FOREIGN KEY ("unidadeOrcamentariaId") REFERENCES "unidades_orcamentarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_demanda" ADD CONSTRAINT "documentos_demanda_pcaId_fkey" FOREIGN KEY ("pcaId") REFERENCES "planos_contratacao_anual"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_demanda" ADD CONSTRAINT "itens_demanda_documentoDemandaId_fkey" FOREIGN KEY ("documentoDemandaId") REFERENCES "documentos_demanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_demanda" ADD CONSTRAINT "itens_demanda_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "itens_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "termos_referencia" ADD CONSTRAINT "termos_referencia_documentoDemandaId_fkey" FOREIGN KEY ("documentoDemandaId") REFERENCES "documentos_demanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_termo_referencia" ADD CONSTRAINT "itens_termo_referencia_termoReferenciaId_fkey" FOREIGN KEY ("termoReferenciaId") REFERENCES "termos_referencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_termo_referencia" ADD CONSTRAINT "itens_termo_referencia_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "itens_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_dotacao" ADD CONSTRAINT "reservas_dotacao_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_dotacao" ADD CONSTRAINT "reservas_dotacao_dotacaoDespesaId_fkey" FOREIGN KEY ("dotacaoDespesaId") REFERENCES "dotacoes_despesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_dotacao" ADD CONSTRAINT "reservas_dotacao_termoReferenciaId_fkey" FOREIGN KEY ("termoReferenciaId") REFERENCES "termos_referencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

