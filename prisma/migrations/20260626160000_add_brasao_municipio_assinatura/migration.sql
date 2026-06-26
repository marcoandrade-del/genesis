-- CreateEnum
CREATE TYPE "ModoAssinatura" AS ENUM ('MANUAL', 'ELETRONICA');

-- AlterTable
ALTER TABLE "entidades" ADD COLUMN     "assinaturaModo" "ModoAssinatura" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "municipios" ADD COLUMN     "brasao" TEXT;
