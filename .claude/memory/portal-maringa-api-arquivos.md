---
name: portal-maringa-api-arquivos
description: "Como baixar QUALQUER arquivo do Portal da Transparência de Maringá (Elotech/OXY): endpoint /api/files/arquivo/{idArquivo}; publicações via /api/publicacoes?entidade=1&exercicio=YYYY"
metadata:
  type: reference
---

# Portal da Transparência de Maringá — API de arquivos

Base: `https://transparencia.maringa.pr.gov.br/portaltransparencia-api`

- **Listar publicações** (grupos → subgrupos → arquivos):
  `GET /api/publicacoes?entidade=1&exercicio=2025` — cada arquivo tem `id`
  (do item) e **`idArquivo`** (o que importa pro download).
- **Baixar arquivo**: `GET /api/files/arquivo/{idArquivo}` — serve o binário
  (PDF/XLS). Descoberto lendo o bundle JS do SPA
  (`/portaltransparencia/static/js/main.*.chunk.js`, grep `"arquivo"`), pois
  `/api/publicacoes/{x}` faz bind de `{x}` como `idGrupo` (Spring BindException).
- O SPA é `maringa.oxy.elotech.com.br` / `transparencia.maringa.pr.gov.br` —
  produto Elotech (OXY). Endpoints de dados que o import da LOA usou:
  `/api/receitas`, `/api/receitas/fonte-recursos`, `/api/despesas...`
  (ver `scripts/importar_orcamento_maringa_2026.ts`).

## LDO 2026 (Lei 11.998, de 21/07/2025) — o que o portal TEM (2026-07-02)
- `idArquivo 1167829` — **Anexo Metas Fiscais, Demonstrativo 7 (Renúncia de
  Receita)**, XLS oficial da Fazenda (01/07/2025) → salvo em
  `data/Material didático/LDO2026_Anexo_MetasFiscais_Dem7_Renuncia.xls`
- `idArquivo 1117045/1117042` — minuta do projeto de lei (SÓ texto, 17 p., sem
  anexos numéricos) → `data/Material didático/LDO2026_minuta_projeto_lei.pdf`
- `idArquivo 1118420` — **APRESENTAÇÃO LDO 2026.pdf** (slides da audiência de
  09/04/2025; provável tabela de Metas Anuais) — download bloqueado por
  instabilidade do tooling local; baixar no navegador:
  https://transparencia.maringa.pr.gov.br/portaltransparencia-api/api/files/arquivo/1118420
- **O Demonstrativo 1 (Metas Anuais — os 5 valores p/ MetaFiscal) NÃO está
  publicado para 2026** (anos 2016–2024 têm "Anexo II - Metas Fiscais" completo;
  2026 só tem a renúncia). Fonte alternativa: Elotech/SEI (lei sancionada com
  anexos) ou Câmara (cmm.pr.gov.br, PL da LDO).

**How to apply:** ao precisar de qualquer publicação de Maringá (LDO/LOA/PPA/
RREO/RGF), listar via `/api/publicacoes` e baixar via `/api/files/arquivo/{id}`
— não perder tempo com o site www3 nem leismunicipais (403, sem anexos). Ver
[[lrf-despesa-epico-plano]] (metas fiscais aguardam os 5 valores da LDO).
