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

## 🎯 ENDPOINT DOS DECRETOS (achado 2026-07-02, sondado e FUNCIONANDO)
`GET /api/creditosadicionais?entidade=1&exercicio=2026` → 200, JSON paginado
Spring (`content[]`; usar `?page=N&size=M`). Cada item = UM item de decreto:
`{despesa: "26.010.06.181.0021.2.125.4.4.90.52.00.00" (programática+natureza),
valorInicial, valor, saldoAtualizado, decreto: "731/2026", natureza:
"Suplementar", fonteRecurso: 2000, sequencia}` — decreto a decreto, com FONTE.
**É a fonte do import de créditos adicionais** (melhor que o líquido do
balancete); casar com DotacaoDespesa pela programática+natureza+fonte e lançar
via CreditosAdicionaisService (nunca editar valorAutorizado na mão — ver
[[alteracoes-orcamentarias-dinamica]]). Há também `/creditosadicionais/report`.

Outros endpoints úteis do bundle (mapa parcial): `arrecadacoes`,
`contab/renuncia-receitas`, `dividas-ativas(/total)`, `liquidacoes/*`
(agenda/aptos/ordem-cronológica de pagamentos), `movimentacao/`,
`receitaxdespesa/empenhado-anual`, `repasses`, `audiencias-publicas(/anexo/
download/)`, `dashboard/arrecadacao-despesa`. Bundle:
`/portaltransparencia/static/js/main.*.chunk.js` (grep `"/api/`).

## 🔴 AO VIVO: execução mensal (`/api/dashboard/arrecadacao-despesa`)
⚠️ Este endpoint exige `entidade` como **HTTP HEADER** (não query): 
`curl -H "entidade: 1" ...?exercicio=2026`. Devolve 12 meses com
valorArrecadado/valorEmpenhado/valorPago/repasses por mês. **VALIDADO
2026-07-02**: Σ jan–jun arrecadado 1.731,66mi (TCE: 1.732,16 — Δ0,03%) e
empenhado 1.746,20mi (TCE: 1.746,40 — Δ0,01%); julho já mostrava movimento
no dia 2 (é tempo quase real). Fonte p/ execução mensal do Gênesis/OXY e
gabarito vivo dos imports. Meses 2026: arr 298,2/436,4/310,0/224,7/236,8/225,5;
emp 311,8/345,5/276,7/272,1/307,8/232,3; pago Σ 969,8mi jan–jun.

⚠️ **Regra do Marco (2026-07-02): o TCE NÃO é tempo real** — recebe os dados
só após a validação contábil das entidades (20–90 dias de atraso em média).
O PORTAL da transparência é o tempo real. Papéis: portal = fonte viva do dia
a dia; TCE = auditoria/homologação a posteriori (números de períodos já
validados). Imports recentes: conferir contra o portal; fechamentos: TCE.

Fontes TCE-PR indicadas pelo deep search (explorar próxima sessão):
- Gerador de relatórios LRF homologados (RREO/RGF):
  servicos.tce.pr.gov.br/consultas/RelatoriosLRFSolicitarNovo.aspx
- PIT — download em massa do SIM-AM (contábil/licitações/contratos):
  pit.tce.pr.gov.br/Dados/DadosConsulta/Consulta
- Página de planejamento do portal (anexos LOA/LDO/PPA 2026-2029, Lei 12.099
  = PPA): maringa.oxy.elotech.com.br/portaltransparencia (seção orçamento).

## Execução por período (endpoints do sync, validados 2026-07-03)
- **Receita natureza×fonte×período**: `/api/receitas/fonte-recursos/detalhes
  ?entidade=1&exercicio=A&fonteRecurso=X&dataInicial=&dataFinal=` (query params).
- **Despesa por programática×período**: `/despesapornivel/detalhada?dataInicial=
  &dataFinal=` com **HEADERS entidade+exercicio** (query de fonte é IGNORADA →
  rateio por fonte no sync). Nível 11 = programática+elemento
  ("02.010.04.122.0002.2001.3.1.90.07" — ação 4 dígitos colada). Campos:
  valorEmpenhado/valorLiquidado/valorPago/valorEmLiquidacao do PERÍODO.
  Σ nível-11 = dashboard ao centavo (validado 6/6 meses).
- ⚠️ Padrão da API: alguns endpoints querem entidade/exercicio como QUERY,
  outros como HEADER (dashboard e despesapornivel = header; 500 se faltar).

## Entidades do portal (`GET /api/entidades/lista` — mapa oficial c/ CNPJ)
1=Prefeitura (nosso banco) · 3=Maringá Previdência · 4=IAM · 6=Câmara ·
9=AMR · 10=SBMG · 15=IPPLAM. Todo endpoint aceita `?entidade={id}` — p/
consolidação municipal, puxar Câmara(6)/Previdência(3) etc.; o QDD deles já
está em `data/qdd_loa_2026_maringa.csv` (órgãos 01/31/50/60/61). O portal
também navega por `/portaltransparencia/{id}/...`.

Links oficiais correlatos (Marco, 2026-07-02): TCE-PR SIM-AM
tce.pr.gov.br/sim-sistema-de-informacoes-municipais (+ layouts em
tce.pr.gov.br/layout-sim-am), STN gov.br/tesouronacional, Câmara cmm.pr.gov.br.

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
