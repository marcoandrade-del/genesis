-- AlterTable
ALTER TABLE "modulos" ADD COLUMN     "ordem" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "lixeira" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "estrutura" JSONB NOT NULL,
    "excluidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluidoPorId" TEXT NOT NULL,

    CONSTRAINT "lixeira_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "lixeira" ADD CONSTRAINT "lixeira_excluidoPorId_fkey" FOREIGN KEY ("excluidoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
