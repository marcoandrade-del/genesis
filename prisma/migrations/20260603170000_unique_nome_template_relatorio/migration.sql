-- CreateIndex
CREATE UNIQUE INDEX "cabecalhos_relatorio_entidadeId_nome_key" ON "cabecalhos_relatorio"("entidadeId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "rodapes_relatorio_entidadeId_nome_key" ON "rodapes_relatorio"("entidadeId", "nome");

