-- CreateEnum
CREATE TYPE "StatusOrcamento" AS ENUM ('RASCUNHO', 'APROVADO', 'EM_EXECUCAO');

-- CreateTable
CREATE TABLE "orcamentos" (
    "id" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "status" "StatusOrcamento" NOT NULL DEFAULT 'RASCUNHO',
    "leiNumero" TEXT,
    "dataAprovacao" TIMESTAMP(3),
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orcamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dotacoes_despesa" (
    "id" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "unidadeOrcamentariaId" TEXT NOT NULL,
    "funcaoId" TEXT NOT NULL,
    "subfuncaoId" TEXT NOT NULL,
    "programaId" TEXT NOT NULL,
    "acaoId" TEXT NOT NULL,
    "contaDespesaEntidadeId" TEXT NOT NULL,
    "fonteRecursoEntidadeId" TEXT NOT NULL,
    "valorAutorizado" DECIMAL(18,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dotacoes_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "previsoes_receita" (
    "id" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "contaReceitaEntidadeId" TEXT NOT NULL,
    "fonteRecursoEntidadeId" TEXT NOT NULL,
    "valorPrevisto" DECIMAL(18,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "previsoes_receita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orcamentos_entidadeId_idx" ON "orcamentos"("entidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "orcamentos_entidadeId_ano_key" ON "orcamentos"("entidadeId", "ano");

-- CreateIndex
CREATE INDEX "dotacoes_despesa_orcamentoId_idx" ON "dotacoes_despesa"("orcamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "dotacoes_despesa_orcamentoId_unidadeOrcamentariaId_funcaoId_key" ON "dotacoes_despesa"("orcamentoId", "unidadeOrcamentariaId", "funcaoId", "subfuncaoId", "programaId", "acaoId", "contaDespesaEntidadeId", "fonteRecursoEntidadeId");

-- CreateIndex
CREATE INDEX "previsoes_receita_orcamentoId_idx" ON "previsoes_receita"("orcamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "previsoes_receita_orcamentoId_contaReceitaEntidadeId_fonteR_key" ON "previsoes_receita"("orcamentoId", "contaReceitaEntidadeId", "fonteRecursoEntidadeId");

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotacoes_despesa" ADD CONSTRAINT "dotacoes_despesa_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotacoes_despesa" ADD CONSTRAINT "dotacoes_despesa_unidadeOrcamentariaId_fkey" FOREIGN KEY ("unidadeOrcamentariaId") REFERENCES "unidades_orcamentarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotacoes_despesa" ADD CONSTRAINT "dotacoes_despesa_funcaoId_fkey" FOREIGN KEY ("funcaoId") REFERENCES "funcoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotacoes_despesa" ADD CONSTRAINT "dotacoes_despesa_subfuncaoId_fkey" FOREIGN KEY ("subfuncaoId") REFERENCES "subfuncoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotacoes_despesa" ADD CONSTRAINT "dotacoes_despesa_programaId_fkey" FOREIGN KEY ("programaId") REFERENCES "programas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotacoes_despesa" ADD CONSTRAINT "dotacoes_despesa_acaoId_fkey" FOREIGN KEY ("acaoId") REFERENCES "acoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotacoes_despesa" ADD CONSTRAINT "dotacoes_despesa_contaDespesaEntidadeId_fkey" FOREIGN KEY ("contaDespesaEntidadeId") REFERENCES "contas_despesa_entidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotacoes_despesa" ADD CONSTRAINT "dotacoes_despesa_fonteRecursoEntidadeId_fkey" FOREIGN KEY ("fonteRecursoEntidadeId") REFERENCES "fontes_recurso_entidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previsoes_receita" ADD CONSTRAINT "previsoes_receita_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previsoes_receita" ADD CONSTRAINT "previsoes_receita_contaReceitaEntidadeId_fkey" FOREIGN KEY ("contaReceitaEntidadeId") REFERENCES "contas_receita_entidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previsoes_receita" ADD CONSTRAINT "previsoes_receita_fonteRecursoEntidadeId_fkey" FOREIGN KEY ("fonteRecursoEntidadeId") REFERENCES "fontes_recurso_entidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

