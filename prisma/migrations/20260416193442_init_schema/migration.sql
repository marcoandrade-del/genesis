-- CreateEnum
CREATE TYPE "TipoItem" AS ENUM ('FUNCIONALIDADE', 'SUBMENU');

-- CreateEnum
CREATE TYPE "TipoFuncionalidade" AS ENUM ('CRUD', 'TELA', 'RELATORIO');

-- CreateEnum
CREATE TYPE "TipoValidacao" AS ENUM ('EMAIL', 'CELULAR');

-- CreateEnum
CREATE TYPE "NivelAcesso" AS ENUM ('VISUALIZAR', 'CRIAR', 'EDITAR', 'EXCLUIR', 'TOTAL');

-- CreateTable
CREATE TABLE "sistemas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sistemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modulos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "sistemaId" TEXT NOT NULL,

    CONSTRAINT "modulos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "icone" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "moduloId" TEXT NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_funcionalidade" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "TipoItem" NOT NULL,
    "tipoFuncionalidade" "TipoFuncionalidade",
    "rota" TEXT,
    "icone" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "menuId" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "itens_funcionalidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "cpf" TEXT,
    "idEstrangeiro" TEXT,
    "nomeCompleto" TEXT NOT NULL,
    "nomeSocial" TEXT NOT NULL,
    "dataNascimento" DATE NOT NULL,
    "emailPrincipal" TEXT NOT NULL,
    "emailAlternativo" TEXT,
    "telefonePrincipal" TEXT NOT NULL,
    "telefoneAlternativo" TEXT,
    "emailValidado" BOOLEAN NOT NULL DEFAULT false,
    "celularValidado" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigos_validacao" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoValidacao" NOT NULL,
    "expiradoEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "codigos_validacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins_sistema" (
    "id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "sistemaId" TEXT NOT NULL,

    CONSTRAINT "admins_sistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins_modulo" (
    "id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "moduloId" TEXT NOT NULL,

    CONSTRAINT "admins_modulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissoes_acesso" (
    "id" TEXT NOT NULL,
    "nivel" "NivelAcesso" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "permissoes_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relatorios_fixos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "rota" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sistemaId" TEXT NOT NULL,

    CONSTRAINT "relatorios_fixos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relatorios_personalizados" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "configuracao" JSONB NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "relatorios_personalizados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pastas_favorito" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parentId" TEXT,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "pastas_favorito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favoritos_relatorio" (
    "id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "pastaId" TEXT,
    "relatorioFixoId" TEXT,
    "relatorioPersonalizadoId" TEXT,

    CONSTRAINT "favoritos_relatorio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sistemas_nome_key" ON "sistemas"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "modulos_nome_sistemaId_key" ON "modulos"("nome", "sistemaId");

-- CreateIndex
CREATE UNIQUE INDEX "menus_nome_moduloId_key" ON "menus"("nome", "moduloId");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_cpf_key" ON "usuarios"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_idEstrangeiro_key" ON "usuarios"("idEstrangeiro");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_emailPrincipal_key" ON "usuarios"("emailPrincipal");

-- CreateIndex
CREATE UNIQUE INDEX "admins_sistema_usuarioId_sistemaId_key" ON "admins_sistema"("usuarioId", "sistemaId");

-- CreateIndex
CREATE UNIQUE INDEX "admins_modulo_usuarioId_moduloId_key" ON "admins_modulo"("usuarioId", "moduloId");

-- CreateIndex
CREATE UNIQUE INDEX "permissoes_acesso_usuarioId_itemId_key" ON "permissoes_acesso"("usuarioId", "itemId");

-- AddForeignKey
ALTER TABLE "modulos" ADD CONSTRAINT "modulos_sistemaId_fkey" FOREIGN KEY ("sistemaId") REFERENCES "sistemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "modulos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_funcionalidade" ADD CONSTRAINT "itens_funcionalidade_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "menus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_funcionalidade" ADD CONSTRAINT "itens_funcionalidade_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "itens_funcionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_validacao" ADD CONSTRAINT "codigos_validacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins_sistema" ADD CONSTRAINT "admins_sistema_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins_sistema" ADD CONSTRAINT "admins_sistema_sistemaId_fkey" FOREIGN KEY ("sistemaId") REFERENCES "sistemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins_modulo" ADD CONSTRAINT "admins_modulo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins_modulo" ADD CONSTRAINT "admins_modulo_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "modulos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissoes_acesso" ADD CONSTRAINT "permissoes_acesso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissoes_acesso" ADD CONSTRAINT "permissoes_acesso_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "itens_funcionalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relatorios_fixos" ADD CONSTRAINT "relatorios_fixos_sistemaId_fkey" FOREIGN KEY ("sistemaId") REFERENCES "sistemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relatorios_personalizados" ADD CONSTRAINT "relatorios_personalizados_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pastas_favorito" ADD CONSTRAINT "pastas_favorito_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "pastas_favorito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pastas_favorito" ADD CONSTRAINT "pastas_favorito_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favoritos_relatorio" ADD CONSTRAINT "favoritos_relatorio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favoritos_relatorio" ADD CONSTRAINT "favoritos_relatorio_pastaId_fkey" FOREIGN KEY ("pastaId") REFERENCES "pastas_favorito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favoritos_relatorio" ADD CONSTRAINT "favoritos_relatorio_relatorioFixoId_fkey" FOREIGN KEY ("relatorioFixoId") REFERENCES "relatorios_fixos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favoritos_relatorio" ADD CONSTRAINT "favoritos_relatorio_relatorioPersonalizadoId_fkey" FOREIGN KEY ("relatorioPersonalizadoId") REFERENCES "relatorios_personalizados"("id") ON DELETE SET NULL ON UPDATE CASCADE;
