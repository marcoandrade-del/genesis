-- CreateEnum
CREATE TYPE "CategoriaDespesa" AS ENUM ('CUSTEIO', 'PESSOAL', 'CAPITAL', 'JUROS', 'AMORTIZACAO');

-- AlterTable
ALTER TABLE "parametros_despesa" ADD COLUMN     "categoria" "CategoriaDespesa";
