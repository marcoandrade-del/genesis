-- CreateTable
CREATE TABLE "planos_contas_receita" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "modeloContabilId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planos_contas_receita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_receita" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "admiteMovimento" BOOLEAN NOT NULL DEFAULT false,
    "planoId" TEXT NOT NULL,
    "parentId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_receita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planos_contas_despesa" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "modeloContabilId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planos_contas_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_despesa" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "admiteMovimento" BOOLEAN NOT NULL DEFAULT false,
    "planoId" TEXT NOT NULL,
    "parentId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fontes_recurso" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "nomenclatura" TEXT NOT NULL,
    "especificacao" TEXT,
    "vinculada" BOOLEAN NOT NULL DEFAULT true,
    "grupo" TEXT,
    "modeloContabilId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fontes_recurso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planos_contas_receita_modeloContabilId_ano_key" ON "planos_contas_receita"("modeloContabilId", "ano");

-- CreateIndex
CREATE INDEX "contas_receita_planoId_parentId_idx" ON "contas_receita"("planoId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_receita_planoId_codigo_key" ON "contas_receita"("planoId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "planos_contas_despesa_modeloContabilId_ano_key" ON "planos_contas_despesa"("modeloContabilId", "ano");

-- CreateIndex
CREATE INDEX "contas_despesa_planoId_parentId_idx" ON "contas_despesa"("planoId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_despesa_planoId_codigo_key" ON "contas_despesa"("planoId", "codigo");

-- CreateIndex
CREATE INDEX "fontes_recurso_modeloContabilId_ano_idx" ON "fontes_recurso"("modeloContabilId", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "fontes_recurso_modeloContabilId_ano_codigo_key" ON "fontes_recurso"("modeloContabilId", "ano", "codigo");

-- AddForeignKey
ALTER TABLE "planos_contas_receita" ADD CONSTRAINT "planos_contas_receita_modeloContabilId_fkey" FOREIGN KEY ("modeloContabilId") REFERENCES "modelos_contabeis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_receita" ADD CONSTRAINT "contas_receita_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos_contas_receita"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_receita" ADD CONSTRAINT "contas_receita_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "contas_receita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos_contas_despesa" ADD CONSTRAINT "planos_contas_despesa_modeloContabilId_fkey" FOREIGN KEY ("modeloContabilId") REFERENCES "modelos_contabeis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_despesa" ADD CONSTRAINT "contas_despesa_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos_contas_despesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_despesa" ADD CONSTRAINT "contas_despesa_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "contas_despesa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fontes_recurso" ADD CONSTRAINT "fontes_recurso_modeloContabilId_fkey" FOREIGN KEY ("modeloContabilId") REFERENCES "modelos_contabeis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
