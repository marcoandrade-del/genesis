-- AlterTable
ALTER TABLE "pastas_favorito" ADD COLUMN     "entidadeId" TEXT;

-- AddForeignKey
ALTER TABLE "pastas_favorito" ADD CONSTRAINT "pastas_favorito_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

