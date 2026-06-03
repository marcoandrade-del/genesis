-- AlterTable
ALTER TABLE "entidades" ADD COLUMN     "brasao" TEXT,
ADD COLUMN     "endereco" TEXT;

-- CreateTable
CREATE TABLE "cabecalhos_relatorio" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "altura" INTEGER NOT NULL DEFAULT 120,
    "layout" JSONB NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "cabecalhos_relatorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rodapes_relatorio" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "altura" INTEGER NOT NULL DEFAULT 80,
    "layout" JSONB NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "rodapes_relatorio_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "cabecalhos_relatorio" ADD CONSTRAINT "cabecalhos_relatorio_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cabecalhos_relatorio" ADD CONSTRAINT "cabecalhos_relatorio_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rodapes_relatorio" ADD CONSTRAINT "rodapes_relatorio_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rodapes_relatorio" ADD CONSTRAINT "rodapes_relatorio_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

