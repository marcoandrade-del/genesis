-- CreateEnum
CREATE TYPE "TipoLancamentoTributario" AS ENUM ('LANCAMENTO', 'INSCRICAO_DIVIDA_ATIVA');

-- AlterEnum
ALTER TYPE "OrigemLancamento" ADD VALUE 'INSCRICAO_DIVIDA_ATIVA';

-- AlterTable
ALTER TABLE "lancamentos_tributarios" ADD COLUMN     "tipo" "TipoLancamentoTributario" NOT NULL DEFAULT 'LANCAMENTO';

-- AlterTable
ALTER TABLE "parametros_receita" ADD COLUMN     "contaDividaAtivaCodigo" TEXT;

