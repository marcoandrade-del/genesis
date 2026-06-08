-- CreateEnum
CREATE TYPE "NaturezaInformacao" AS ENUM ('PATRIMONIAL', 'ORCAMENTARIA', 'CONTROLE');

-- CreateEnum
CREATE TYPE "NaturezaSaldo" AS ENUM ('DEVEDORA', 'CREDORA', 'MISTA');

-- CreateEnum
CREATE TYPE "SuperavitFinanceiro" AS ENUM ('FINANCEIRO', 'PATRIMONIAL', 'MISTA', 'OUTROS_CONTROLES');

-- AlterTable
ALTER TABLE "contas" ADD COLUMN     "naturezaInformacao" "NaturezaInformacao",
ADD COLUMN     "naturezaSaldo" "NaturezaSaldo",
ADD COLUMN     "superavitFinanceiro" "SuperavitFinanceiro",
ADD COLUMN     "funcao" TEXT;
