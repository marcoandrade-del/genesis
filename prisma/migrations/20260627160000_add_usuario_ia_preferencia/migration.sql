-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "iaEngine" TEXT NOT NULL DEFAULT 'rapida',
ADD COLUMN     "iaMotor" TEXT NOT NULL DEFAULT 'gemini';
