-- CreateEnum
CREATE TYPE "StatusSolicitacaoAcesso" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "solicitacoes_acesso_entidade" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "nivelSolicitado" "NivelAcessoEntidade" NOT NULL,
    "justificativa" TEXT,
    "status" "StatusSolicitacaoAcesso" NOT NULL DEFAULT 'PENDENTE',
    "nivelConcedido" "NivelAcessoEntidade",
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "observacaoDecisao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitacoes_acesso_entidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitacoes_acesso_entidade_usuarioId_idx" ON "solicitacoes_acesso_entidade"("usuarioId");

-- CreateIndex
CREATE INDEX "solicitacoes_acesso_entidade_entidadeId_status_idx" ON "solicitacoes_acesso_entidade"("entidadeId", "status");

-- AddForeignKey
ALTER TABLE "solicitacoes_acesso_entidade" ADD CONSTRAINT "solicitacoes_acesso_entidade_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_acesso_entidade" ADD CONSTRAINT "solicitacoes_acesso_entidade_entidadeId_fkey" FOREIGN KEY ("entidadeId") REFERENCES "entidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_acesso_entidade" ADD CONSTRAINT "solicitacoes_acesso_entidade_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
