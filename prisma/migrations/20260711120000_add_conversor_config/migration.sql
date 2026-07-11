-- CreateTable
CREATE TABLE "conversor_municipios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ibge" TEXT NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "ano" INTEGER NOT NULL,
    "fabricante" TEXT NOT NULL,
    "tce" TEXT NOT NULL,
    "portalUrl" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversor_municipios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversor_entidades" (
    "id" TEXT NOT NULL,
    "municipioId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoEntidade" NOT NULL,
    "matchPit" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversor_entidades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversor_municipios_ibge_ano_key" ON "conversor_municipios"("ibge", "ano");

-- AddForeignKey
ALTER TABLE "conversor_entidades" ADD CONSTRAINT "conversor_entidades_municipioId_fkey" FOREIGN KEY ("municipioId") REFERENCES "conversor_municipios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
