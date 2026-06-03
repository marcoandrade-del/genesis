-- CreateEnum
CREATE TYPE "TipoPessoa" AS ENUM ('PJ', 'PF');

-- CreateEnum
CREATE TYPE "ModalidadeLicitacao" AS ENUM ('PREGAO', 'CONCORRENCIA', 'DISPENSA', 'INEXIGIBILIDADE');

-- CreateEnum
CREATE TYPE "CriterioJulgamento" AS ENUM ('POR_ITEM', 'POR_LOTE');

-- CreateEnum
CREATE TYPE "StatusProcesso" AS ENUM ('ABERTO', 'HOMOLOGADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusContrato" AS ENUM ('VIGENTE', 'ENCERRADO', 'RESCINDIDO');

-- CreateEnum
CREATE TYPE "StatusAta" AS ENUM ('VIGENTE', 'ENCERRADA');

-- CreateTable
CREATE TABLE "fornecedores" (
    "id" TEXT NOT NULL,
    "tipoPessoa" "TipoPessoa" NOT NULL,
    "cnpj" TEXT,
    "cpf" TEXT,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processos" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "modalidade" "ModalidadeLicitacao" NOT NULL,
    "criterioJulgamento" "CriterioJulgamento" NOT NULL DEFAULT 'POR_ITEM',
    "objeto" TEXT NOT NULL,
    "termoReferenciaId" TEXT,
    "status" "StatusProcesso" NOT NULL DEFAULT 'ABERTO',
    "dataAbertura" TIMESTAMP(3),
    "dataHomologacao" TIMESTAMP(3),
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes" (
    "id" TEXT NOT NULL,
    "processoId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "descricao" TEXT,
    "fornecedorVencedorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_processo" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "itemCatalogoId" TEXT NOT NULL,
    "quantidade" DECIMAL(18,4) NOT NULL,
    "precoEstimadoUnitario" DECIMAL(18,2) NOT NULL,
    "fornecedorVencedorId" TEXT,
    "precoAdjudicadoUnitario" DECIMAL(18,2),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratos" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "processoId" TEXT,
    "fornecedorId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "objeto" TEXT NOT NULL,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3) NOT NULL,
    "valorTotal" DECIMAL(18,2) NOT NULL,
    "status" "StatusContrato" NOT NULL DEFAULT 'VIGENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contratos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_contrato" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "itemCatalogoId" TEXT NOT NULL,
    "quantidadeContratada" DECIMAL(18,4) NOT NULL,
    "precoUnitario" DECIMAL(18,2) NOT NULL,
    "quantidadeEmpenhada" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atas_registro_preco" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "processoId" TEXT,
    "fornecedorId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "objeto" TEXT NOT NULL,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3) NOT NULL,
    "status" "StatusAta" NOT NULL DEFAULT 'VIGENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "atas_registro_preco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_ata_registro_preco" (
    "id" TEXT NOT NULL,
    "ataId" TEXT NOT NULL,
    "itemCatalogoId" TEXT NOT NULL,
    "quantidadeRegistrada" DECIMAL(18,4) NOT NULL,
    "precoUnitario" DECIMAL(18,2) NOT NULL,
    "quantidadeUtilizada" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_ata_registro_preco_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fornecedores_cnpj_key" ON "fornecedores"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedores_cpf_key" ON "fornecedores"("cpf");

-- CreateIndex
CREATE INDEX "processos_entidadeId_ano_idx" ON "processos"("entidadeId", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "processos_entidadeId_ano_numero_key" ON "processos"("entidadeId", "ano", "numero");

-- CreateIndex
CREATE INDEX "lotes_processoId_idx" ON "lotes"("processoId");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_processoId_numero_key" ON "lotes"("processoId", "numero");

-- CreateIndex
CREATE INDEX "itens_processo_loteId_idx" ON "itens_processo"("loteId");

-- CreateIndex
CREATE UNIQUE INDEX "itens_processo_loteId_itemCatalogoId_key" ON "itens_processo"("loteId", "itemCatalogoId");

-- CreateIndex
CREATE INDEX "contratos_entidadeId_idx" ON "contratos"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "contratos_entidadeId_numero_key" ON "contratos"("entidadeId", "numero");

-- CreateIndex
CREATE INDEX "itens_contrato_contratoId_idx" ON "itens_contrato"("contratoId");

-- CreateIndex
CREATE UNIQUE INDEX "itens_contrato_contratoId_itemCatalogoId_key" ON "itens_contrato"("contratoId", "itemCatalogoId");

-- CreateIndex
CREATE INDEX "atas_registro_preco_entidadeId_idx" ON "atas_registro_preco"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "atas_registro_preco_entidadeId_numero_key" ON "atas_registro_preco"("entidadeId", "numero");

-- CreateIndex
CREATE INDEX "itens_ata_registro_preco_ataId_idx" ON "itens_ata_registro_preco"("ataId");

-- CreateIndex
CREATE UNIQUE INDEX "itens_ata_registro_preco_ataId_itemCatalogoId_key" ON "itens_ata_registro_preco"("ataId", "itemCatalogoId");

-- AddForeignKey
ALTER TABLE "processos" ADD CONSTRAINT "processos_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processos" ADD CONSTRAINT "processos_termoReferenciaId_fkey" FOREIGN KEY ("termoReferenciaId") REFERENCES "termos_referencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_fornecedorVencedorId_fkey" FOREIGN KEY ("fornecedorVencedorId") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_processo" ADD CONSTRAINT "itens_processo_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "lotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_processo" ADD CONSTRAINT "itens_processo_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "itens_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_processo" ADD CONSTRAINT "itens_processo_fornecedorVencedorId_fkey" FOREIGN KEY ("fornecedorVencedorId") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "processos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_contrato" ADD CONSTRAINT "itens_contrato_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_contrato" ADD CONSTRAINT "itens_contrato_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "itens_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atas_registro_preco" ADD CONSTRAINT "atas_registro_preco_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atas_registro_preco" ADD CONSTRAINT "atas_registro_preco_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "processos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atas_registro_preco" ADD CONSTRAINT "atas_registro_preco_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_ata_registro_preco" ADD CONSTRAINT "itens_ata_registro_preco_ataId_fkey" FOREIGN KEY ("ataId") REFERENCES "atas_registro_preco"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_ata_registro_preco" ADD CONSTRAINT "itens_ata_registro_preco_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "itens_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

