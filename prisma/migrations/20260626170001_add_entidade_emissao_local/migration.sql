-- CreateEnum
CREATE TYPE "EmissaoLocal" AS ENUM ('RODAPE', 'CABECALHO', 'NENHUM');

-- AlterTable
ALTER TABLE "entidades" ADD COLUMN     "emissaoLocal" "EmissaoLocal" NOT NULL DEFAULT 'RODAPE';
