/*
  Warnings:

  - You are about to drop the column `municipioId` on the `lancamentos` table. All the data in the column will be lost.
  - The primary key for the `resumos_mensais_conta` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `municipioId` on the `resumos_mensais_conta` table. All the data in the column will be lost.
  - The primary key for the `saldos_iniciais_ano` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `municipioId` on the `saldos_iniciais_ano` table. All the data in the column will be lost.
  - Added the required column `entidadeId` to the `lancamentos` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entidadeId` to the `resumos_mensais_conta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entidadeId` to the `saldos_iniciais_ano` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "lancamento_itens" DROP CONSTRAINT "lancamento_itens_contaId_fkey";

-- DropForeignKey
ALTER TABLE "lancamentos" DROP CONSTRAINT "lancamentos_municipioId_fkey";

-- DropForeignKey
ALTER TABLE "resumos_mensais_conta" DROP CONSTRAINT "resumos_mensais_conta_contaId_fkey";

-- DropForeignKey
ALTER TABLE "resumos_mensais_conta" DROP CONSTRAINT "resumos_mensais_conta_municipioId_fkey";

-- DropForeignKey
ALTER TABLE "saldos_iniciais_ano" DROP CONSTRAINT "saldos_iniciais_ano_contaId_fkey";

-- DropForeignKey
ALTER TABLE "saldos_iniciais_ano" DROP CONSTRAINT "saldos_iniciais_ano_municipioId_fkey";

-- DropIndex
DROP INDEX "lancamentos_municipioId_data_idx";

-- AlterTable
ALTER TABLE "lancamentos" DROP COLUMN "municipioId",
ADD COLUMN     "entidadeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "resumos_mensais_conta" DROP CONSTRAINT "resumos_mensais_conta_pkey",
DROP COLUMN "municipioId",
ADD COLUMN     "entidadeId" TEXT NOT NULL,
ADD CONSTRAINT "resumos_mensais_conta_pkey" PRIMARY KEY ("entidadeId", "contaId", "ano", "mes");

-- AlterTable
ALTER TABLE "saldos_iniciais_ano" DROP CONSTRAINT "saldos_iniciais_ano_pkey",
DROP COLUMN "municipioId",
ADD COLUMN     "entidadeId" TEXT NOT NULL,
ADD CONSTRAINT "saldos_iniciais_ano_pkey" PRIMARY KEY ("entidadeId", "contaId", "ano");

-- CreateIndex
CREATE INDEX "lancamentos_entidadeId_data_idx" ON "lancamentos"("entidadeId", "data");

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento_itens" ADD CONSTRAINT "lancamento_itens_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas_contabil_entidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumos_mensais_conta" ADD CONSTRAINT "resumos_mensais_conta_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumos_mensais_conta" ADD CONSTRAINT "resumos_mensais_conta_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas_contabil_entidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_iniciais_ano" ADD CONSTRAINT "saldos_iniciais_ano_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_iniciais_ano" ADD CONSTRAINT "saldos_iniciais_ano_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas_contabil_entidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
