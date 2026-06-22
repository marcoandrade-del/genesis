-- CreateTable
CREATE TABLE "ordens_item_usuario" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "ordens_item_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ordens_item_usuario_usuarioId_itemId_key" ON "ordens_item_usuario"("usuarioId", "itemId");

-- AddForeignKey
ALTER TABLE "ordens_item_usuario" ADD CONSTRAINT "ordens_item_usuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_item_usuario" ADD CONSTRAINT "ordens_item_usuario_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "itens_funcionalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
