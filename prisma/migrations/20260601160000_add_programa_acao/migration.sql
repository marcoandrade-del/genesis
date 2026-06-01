
-- CreateEnum
CREATE TYPE "TipoPrograma" AS ENUM ('FINALISTICO', 'GESTAO', 'OPERACOES_ESPECIAIS');

-- CreateEnum
CREATE TYPE "TipoAcao" AS ENUM ('PROJETO', 'ATIVIDADE', 'OPERACAO_ESPECIAL');

-- CreateTable
CREATE TABLE "programas" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "objetivo" TEXT,
    "tipo" "TipoPrograma" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acoes" (
    "id" TEXT NOT NULL,
    "programaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoAcao" NOT NULL,
    "unidadeMedida" TEXT,
    "metaFisica" DECIMAL(18,2),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "programas_entidadeId_ano_idx" ON "programas"("entidadeId", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "programas_entidadeId_ano_codigo_key" ON "programas"("entidadeId", "ano", "codigo");

-- CreateIndex
CREATE INDEX "acoes_programaId_idx" ON "acoes"("programaId");

-- CreateIndex
CREATE UNIQUE INDEX "acoes_programaId_codigo_key" ON "acoes"("programaId", "codigo");

-- AddForeignKey
ALTER TABLE "programas" ADD CONSTRAINT "programas_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acoes" ADD CONSTRAINT "acoes_programaId_fkey" FOREIGN KEY ("programaId") REFERENCES "programas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

