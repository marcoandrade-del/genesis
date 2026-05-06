-- CreateTable
CREATE TABLE "favoritos_item" (
    "id" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "favoritos_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "favoritos_item_usuarioId_itemId_key" ON "favoritos_item"("usuarioId", "itemId");

-- AddForeignKey
ALTER TABLE "favoritos_item" ADD CONSTRAINT "favoritos_item_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favoritos_item" ADD CONSTRAINT "favoritos_item_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "itens_funcionalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
