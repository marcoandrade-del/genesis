-- CreateTable: detalhe da abertura patrimonial por conta-corrente (fonte).
-- Aditiva — não toca saldos_iniciais_ano (que segue como agregado por conta).
CREATE TABLE "saldos_iniciais_cc" (
    "entidadeId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "fonteCodigo" TEXT NOT NULL DEFAULT '',
    "valor" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "saldos_iniciais_cc_pkey" PRIMARY KEY ("entidadeId","contaId","ano","fonteCodigo")
);

-- AddForeignKey
ALTER TABLE "saldos_iniciais_cc" ADD CONSTRAINT "saldos_iniciais_cc_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_iniciais_cc" ADD CONSTRAINT "saldos_iniciais_cc_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas_contabil_entidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
