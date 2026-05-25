-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('DEBITO', 'CREDITO');

-- CreateTable
CREATE TABLE "modelos_contabeis" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modelos_contabeis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estados" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "sigla" CHAR(2) NOT NULL,
    "modeloContabilId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "estadoId" TEXT NOT NULL,
    "modeloContabilId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "municipios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planos_de_contas" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "modeloContabilId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planos_de_contas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "admiteMovimento" BOOLEAN NOT NULL DEFAULT false,
    "planoId" TEXT NOT NULL,
    "parentId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamentos" (
    "id" TEXT NOT NULL,
    "municipioId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "historico" TEXT NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamento_itens" (
    "id" TEXT NOT NULL,
    "lancamentoId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "tipo" "TipoLancamento" NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "lancamento_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumos_mensais_conta" (
    "municipioId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "totalDebito" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCredito" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "resumos_mensais_conta_pkey" PRIMARY KEY ("municipioId","contaId","ano","mes")
);

-- CreateTable
CREATE TABLE "saldos_iniciais_ano" (
    "municipioId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "saldos_iniciais_ano_pkey" PRIMARY KEY ("municipioId","contaId","ano")
);

-- CreateIndex
CREATE UNIQUE INDEX "modelos_contabeis_descricao_key" ON "modelos_contabeis"("descricao");

-- CreateIndex
CREATE UNIQUE INDEX "estados_nome_key" ON "estados"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "estados_sigla_key" ON "estados"("sigla");

-- CreateIndex
CREATE UNIQUE INDEX "municipios_nome_estadoId_key" ON "municipios"("nome", "estadoId");

-- CreateIndex
CREATE UNIQUE INDEX "planos_de_contas_modeloContabilId_ano_key" ON "planos_de_contas"("modeloContabilId", "ano");

-- CreateIndex
CREATE INDEX "contas_planoId_parentId_idx" ON "contas"("planoId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_planoId_codigo_key" ON "contas"("planoId", "codigo");

-- CreateIndex
CREATE INDEX "lancamentos_municipioId_data_idx" ON "lancamentos"("municipioId", "data");

-- CreateIndex
CREATE INDEX "lancamento_itens_contaId_idx" ON "lancamento_itens"("contaId");

-- AddForeignKey
ALTER TABLE "estados" ADD CONSTRAINT "estados_modeloContabilId_fkey" FOREIGN KEY ("modeloContabilId") REFERENCES "modelos_contabeis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "municipios" ADD CONSTRAINT "municipios_estadoId_fkey" FOREIGN KEY ("estadoId") REFERENCES "estados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "municipios" ADD CONSTRAINT "municipios_modeloContabilId_fkey" FOREIGN KEY ("modeloContabilId") REFERENCES "modelos_contabeis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos_de_contas" ADD CONSTRAINT "planos_de_contas_modeloContabilId_fkey" FOREIGN KEY ("modeloContabilId") REFERENCES "modelos_contabeis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas" ADD CONSTRAINT "contas_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos_de_contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas" ADD CONSTRAINT "contas_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "contas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_municipioId_fkey" FOREIGN KEY ("municipioId") REFERENCES "municipios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento_itens" ADD CONSTRAINT "lancamento_itens_lancamentoId_fkey" FOREIGN KEY ("lancamentoId") REFERENCES "lancamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento_itens" ADD CONSTRAINT "lancamento_itens_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumos_mensais_conta" ADD CONSTRAINT "resumos_mensais_conta_municipioId_fkey" FOREIGN KEY ("municipioId") REFERENCES "municipios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumos_mensais_conta" ADD CONSTRAINT "resumos_mensais_conta_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_iniciais_ano" ADD CONSTRAINT "saldos_iniciais_ano_municipioId_fkey" FOREIGN KEY ("municipioId") REFERENCES "municipios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_iniciais_ano" ADD CONSTRAINT "saldos_iniciais_ano_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
