-- Fonte no padrão STN/Siconfi no catálogo de fontes da entidade (de/para local→STN).
-- O emissor da MSC (matriz-saldos-contabeis) converte a fonte local→STN na SAÍDA
-- usando esta coluna; o razão segue no modelo local. null = sem de/para (passa direto).
ALTER TABLE "fontes_recurso_entidade" ADD COLUMN "fonteStnCodigo" TEXT;
