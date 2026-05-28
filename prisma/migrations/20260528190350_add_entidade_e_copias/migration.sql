-- CreateEnum
CREATE TYPE "TipoEntidade" AS ENUM ('PREFEITURA', 'CAMARA', 'ADM_INDIRETA');

-- CreateEnum
CREATE TYPE "OrigemConta" AS ENUM ('MODELO', 'DESDOBRAMENTO');

-- CreateTable
CREATE TABLE "entidades" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoEntidade" NOT NULL,
    "cnpj" TEXT,
    "municipioId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_contabil_entidade" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "admiteMovimento" BOOLEAN NOT NULL DEFAULT false,
    "origem" "OrigemConta" NOT NULL DEFAULT 'MODELO',
    "modeloContaId" TEXT,
    "parentId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_contabil_entidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_receita_entidade" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "admiteMovimento" BOOLEAN NOT NULL DEFAULT false,
    "origem" "OrigemConta" NOT NULL DEFAULT 'MODELO',
    "modeloContaId" TEXT,
    "parentId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_receita_entidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_despesa_entidade" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "admiteMovimento" BOOLEAN NOT NULL DEFAULT false,
    "origem" "OrigemConta" NOT NULL DEFAULT 'MODELO',
    "modeloContaId" TEXT,
    "parentId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_despesa_entidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fontes_recurso_entidade" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "nomenclatura" TEXT NOT NULL,
    "especificacao" TEXT,
    "vinculada" BOOLEAN NOT NULL DEFAULT true,
    "grupo" TEXT,
    "origem" "OrigemConta" NOT NULL DEFAULT 'MODELO',
    "modeloFonteId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fontes_recurso_entidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entidades_cnpj_key" ON "entidades"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "entidades_municipioId_nome_key" ON "entidades"("municipioId", "nome");

-- CreateIndex
CREATE INDEX "contas_contabil_entidade_entidadeId_ano_parentId_idx" ON "contas_contabil_entidade"("entidadeId", "ano", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_contabil_entidade_entidadeId_ano_codigo_key" ON "contas_contabil_entidade"("entidadeId", "ano", "codigo");

-- CreateIndex
CREATE INDEX "contas_receita_entidade_entidadeId_ano_parentId_idx" ON "contas_receita_entidade"("entidadeId", "ano", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_receita_entidade_entidadeId_ano_codigo_key" ON "contas_receita_entidade"("entidadeId", "ano", "codigo");

-- CreateIndex
CREATE INDEX "contas_despesa_entidade_entidadeId_ano_parentId_idx" ON "contas_despesa_entidade"("entidadeId", "ano", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_despesa_entidade_entidadeId_ano_codigo_key" ON "contas_despesa_entidade"("entidadeId", "ano", "codigo");

-- CreateIndex
CREATE INDEX "fontes_recurso_entidade_entidadeId_ano_idx" ON "fontes_recurso_entidade"("entidadeId", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "fontes_recurso_entidade_entidadeId_ano_codigo_key" ON "fontes_recurso_entidade"("entidadeId", "ano", "codigo");

-- AddForeignKey
ALTER TABLE "entidades" ADD CONSTRAINT "entidades_municipioId_fkey" FOREIGN KEY ("municipioId") REFERENCES "municipios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_contabil_entidade" ADD CONSTRAINT "contas_contabil_entidade_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_contabil_entidade" ADD CONSTRAINT "contas_contabil_entidade_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "contas_contabil_entidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_receita_entidade" ADD CONSTRAINT "contas_receita_entidade_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_receita_entidade" ADD CONSTRAINT "contas_receita_entidade_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "contas_receita_entidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_despesa_entidade" ADD CONSTRAINT "contas_despesa_entidade_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_despesa_entidade" ADD CONSTRAINT "contas_despesa_entidade_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "contas_despesa_entidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fontes_recurso_entidade" ADD CONSTRAINT "fontes_recurso_entidade_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
