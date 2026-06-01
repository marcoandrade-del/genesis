-- CreateEnum
CREATE TYPE "NivelAcessoEntidade" AS ENUM ('LEITURA', 'ESCRITA', 'ADMIN');

-- CreateTable
CREATE TABLE "acessos_entidade" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "nivel" "NivelAcessoEntidade" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acessos_entidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "acessos_entidade_usuarioId_idx" ON "acessos_entidade"("usuarioId");

-- CreateIndex
CREATE INDEX "acessos_entidade_entidadeId_idx" ON "acessos_entidade"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "acessos_entidade_usuarioId_entidadeId_key" ON "acessos_entidade"("usuarioId", "entidadeId");

-- AddForeignKey
ALTER TABLE "acessos_entidade" ADD CONSTRAINT "acessos_entidade_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_entidade" ADD CONSTRAINT "acessos_entidade_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

