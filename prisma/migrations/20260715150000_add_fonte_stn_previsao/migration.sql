-- Fonte no padrão STN/Siconfi por previsão (a correspondência oficial é
-- fonte×aplicação → STN, granularidade natureza×fonte — não cabe 1:1 no catálogo).
ALTER TABLE "previsoes_receita" ADD COLUMN "fonteStnCodigo" TEXT;
