-- CreateTable
CREATE TABLE "solicitacoes_memorial" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "estadoId" TEXT NOT NULL,
    "entidadePreviewId" TEXT,
    "ano" INTEGER,
    "rclComposicao" JSONB,
    "fonteClassificacao" JSONB,
    "pessoalComposicao" JSONB,
    "justificativa" TEXT,
    "status" "StatusSolicitacaoAcesso" NOT NULL DEFAULT 'PENDENTE',
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "observacaoDecisao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitacoes_memorial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitacoes_memorial_usuarioId_idx" ON "solicitacoes_memorial"("usuarioId");

-- CreateIndex
CREATE INDEX "solicitacoes_memorial_estadoId_status_idx" ON "solicitacoes_memorial"("estadoId", "status");

-- AddForeignKey
ALTER TABLE "solicitacoes_memorial" ADD CONSTRAINT "solicitacoes_memorial_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_memorial" ADD CONSTRAINT "solicitacoes_memorial_estadoId_fkey" FOREIGN KEY ("estadoId") REFERENCES "estados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_memorial" ADD CONSTRAINT "solicitacoes_memorial_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
