-- CreateTable
CREATE TABLE "funcoes" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "funcoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subfuncoes" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "funcaoId" TEXT NOT NULL,

    CONSTRAINT "subfuncoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades_orcamentarias" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidades_orcamentarias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "funcoes_codigo_key" ON "funcoes"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "subfuncoes_codigo_key" ON "subfuncoes"("codigo");

-- CreateIndex
CREATE INDEX "subfuncoes_funcaoId_idx" ON "subfuncoes"("funcaoId");

-- CreateIndex
CREATE INDEX "unidades_orcamentarias_entidadeId_idx" ON "unidades_orcamentarias"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_orcamentarias_entidadeId_codigo_key" ON "unidades_orcamentarias"("entidadeId", "codigo");

-- AddForeignKey
ALTER TABLE "subfuncoes" ADD CONSTRAINT "subfuncoes_funcaoId_fkey" FOREIGN KEY ("funcaoId") REFERENCES "funcoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_orcamentarias" ADD CONSTRAINT "unidades_orcamentarias_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
