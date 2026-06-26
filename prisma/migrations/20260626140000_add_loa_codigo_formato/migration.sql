-- CreateEnum
CREATE TYPE "FormatoCodigoConta" AS ENUM ('COMPLETO', 'CURTO', 'NIVEL');

-- AlterTable
ALTER TABLE "estados" ADD COLUMN     "loaCodigoModo" "FormatoCodigoConta" NOT NULL DEFAULT 'CURTO',
ADD COLUMN     "loaCodigoNivel" INTEGER NOT NULL DEFAULT 4;

-- AlterTable
ALTER TABLE "municipios" ADD COLUMN     "loaCodigoModo" "FormatoCodigoConta",
ADD COLUMN     "loaCodigoNivel" INTEGER;
