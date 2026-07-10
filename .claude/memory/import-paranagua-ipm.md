---
name: import-paranagua-ipm
description: "Importar Paranaguá/PR (município IPM Sistemas, não Elotech): execução via PIT é município-agnóstica e reusa o pipeline do Maringá ao centavo; portal IPM atende.net tem os dados bloqueados por CAPTCHA (endpoints mapeados)"
metadata:
  node_type: memory
  type: project
  originSessionId: da9ed666-7da5-40c7-906d-5e887fa3f9a0
---

# Importar Paranaguá/PR (IPM Sistemas) — reuso do pipeline Maringá

Frente 2026-07-09. Paranaguá usa **IPM Sistemas** (portal atende.net), não Elotech. Tese confirmada: **muito reusa** porque a execução não vem do sistema de gestão, vem do TCE-PR.

## Execução: PIT/TCE-PR é MUNICÍPIO-AGNÓSTICO (o grande reuso) ✅ FEITO
- `https://pit.tce.pr.gov.br/Arquivos/2026/2026_411820_Despesa.zip` (Paranaguá ibge6 **411820**). Mesma fonte estadual de qualquer município PR, INDEPENDENTE de IPM/Elotech. Schema do `Empenho.xml` **idêntico** ao Maringá → parser reusa sem mudança. ⚠️ o XML é **UTF-8 com BOM** apesar da declaração `iso-8859-1` (ler como UTF-8 + strip BOM; senão o match de `nmEntidade` quebra).
- Entidades no PIT (5.883 empenhos, Σ R$ 510,19mi): Prefeitura "MUNICÍPIO DE PARANAGUÁ" 474,67 · Previdência 19,40 · **Câmara** 10,37 · +CISLIPA (consórcio) e Central de Água do Litoral (regionais, FORA do escopo).
- Writer NOVO `scripts/importar_execucao_pit_paranagua.ts` (dry-run/`--apply`): agrega empenhos pela CHAVE DE DOTAÇÃO exata (UO×função×subf×prog×ação×natureza×fonte) — **sem rateio** (PIT traz fonte exata por empenho, mais preciso que a captura CAP-* do portal Elotech). Grava dotação + empenho CAP-* + MovimentoEmpenho, espelhando `sincronizacao-portal.despesaMes`. **Materializado ao centavo × PIT nas 3 entidades** (Pref 792 dotações, Câmara 55, Prev 49).
- 🐛 BUG pego na verificação: naturezas distintas que caem na MESMA conta sintética (fallback pro elemento `.00.00`, quando não há folha no plano) colapsam na mesma `dotacao_unica` → o write path precisa **SOMAR**, não sobrescrever `valorEmpenhado` (senão perde a 2ª; faltavam R$76mil na Prefeitura). Fix: agregar por dotação RESOLVIDA antes de gravar.
- Fonte da despesa: usar `cdFontePadrao` do PIT direto como código (esquema PCASP-novo 000/001/101…, mesmo dos seeds 500/540/600); criar sob demanda origem DESDOBRAMENTO (o de/para do QDD Maringá em `importar_execucao_pit.ts` NÃO se aplica aqui).

## Onboarding ✅ FEITO
Município "Paranaguá"/PR criado (herda modelo **PARANÁ** do estado). 3 entidades via `EntidadeService.criar` (Prefeitura/Câmara/Previdência) — copia plano de contas do modelo (desp 3902·rec 1808·cont 8761) + fontes-base (3); catálogo de fontes preenche sob demanda no import (como as 215 DESDOBRAMENTO do Maringá). Orçamento 2026 por entidade (RASCUNHO). Script `scripts/onboard_paranagua_2026.ts`.

## LOA (previsão + dotação inicial): portal IPM atende.net — ⚠️ CAPTCHA
Portal `https://paranagua.atende.net/transparencia/`. **Discovery 100% por GET** (landing → `/transparencia/grupo/<slug>` → `/transparencia/item/<slug>`; menus em base64 no atributo `dados=`; ISO-8859-1). **Mas o passo `processaDados` (linhas de dados) é BLOQUEADO por Cloudflare Turnstile** (config do servidor `captcha:"2"` = obrigatório p/ anônimo/LAI; sitekey `0x4AAAAAADe3f6WPETSvaNhb`). Coletor HTTP puro NÃO passa; só navegador headless com IP residencial.
- Endpoints (rotina/ação) mapeados e validados via `montaTela`: **LOA receita 45081/101** (conta/categoria/desdobramento/**fonte**), **LOA despesa 45107/101** (órgão→ação/elemento/**vínculo-fonte**/dotacaoCompleta/valor), execução mensal **despesa 45628/101** (`mes` 01–12) e **receita 45084/101** (`dataInicial/dataFinal`). Filtro entidade `clicodigo`/`clientecodigo`, ano `loaano`/`ano`.
- **Entidades no portal IPM: 3037 Prefeitura · 14358 Previdência · 21334 Fundação de Assistência à Saúde — SEM Câmara** (portal próprio). Diverge do PIT (que tem Câmara, não a Fundação).
- Brecha SEM captcha: **Dados Abertos CSV, rotina 50047/102** (`exigeCaptcha:false`); "Orçamento da Receita" = grupo 2/item 6/tipo 1, `formatoImpressao=csv`. `montaTela` dá 200 mas a geração deu HTTP 500 interno (provável fluxo ASSÍNCRONO de relatório: enfileira→monitora→baixa). EM INVESTIGAÇÃO. Se não sair: alternativas = PDF da LOA (parser como Maringá) ou headless na máquina do Marco.
- `valorAutorizado` da execução era PROXY (maior `vlSaldoAntDotacao`) — RECONCILIADO p/ a Prefeitura pela LOA (abaixo).

## LOA IMPORTADA (via CSV Dados Abertos exportado pelo Marco no navegador) ✅
O captcha só barra HTTP puro; **Marco exportou os CSVs pelo browser** (IP residencial passa o Turnstile) e me passou em `~/Downloads`. Importadores novos, ao centavo:
- **RECEITA** `importar_receita_loa_paranagua_ipm.ts` — CSV traz 3 entidades (Prefeitura, Previdência, **Fundação de Assistência à Saúde** — onboardada; Câmara NÃO tem receita no portal IPM). Código do CSV (19 díg "4111…") → conta do banco: **dropar 1º díg + fatiar `[1,1,1,1,2,1,1,2,2,2,2,2]`** → "1.1.1.0.00…". Importa só as FOLHAS (nível espécie); Σ folhas = Σ nível-1 (conferência). Pref 1.350.900.754,72 (bruta) · Prev 140.347.000 · Fundação 11.452.268,60. Ressalvas: **sem fonte** no export → fonte placeholder `0000`; deduções FUNDEB (código "9…", −68,8mi) sinalizadas mas NÃO gravadas (falta conta redutora); conta intra (cat-7) criada sob demanda (modelo não tem).
- **DESPESA** `importar_despesa_loa_paranagua_ipm.ts` — CSV é **só a Prefeitura** (26 órgãos, 1628 dotações). Natureza: **dropar 1º díg "3" → C.G.MM.EE** ("3319011"→3.1.90.11; "3319113"→3.1.**91**.13 intra). Funcional "0004.0122.0057" = função(2)/subfunção(3)/programa(4). Fonte = vínculo 5-díg. **valorAutorizado = R$ 1.105.490.611,74 ao centavo**. ⚠️ CSV tem **quebra de linha DENTRO de aspas** (órgão 15) → precisa parser CSV real (state-machine), não split por linha.
- Zerado o proxy da execução; Σ autorizado = LOA, Σ empenhado = PIT.

## RECONCILIAÇÃO execução×LOA (follow-up #1) ✅ FEITA — `reconciliar_execucao_loa_paranagua.ts`
Objetivo: cada dotação da Prefeitura com **orçado (LOA) + empenhado (PIT) na MESMA linha**. Dois de/para:
1. **NATUREZA**: PIT vem no desdobramento → agregar ao **ELEMENTO** (`cat.grp.mod.ele.00.00`, nível da LOA).
2. **FONTE**: ⚠️ **PIT e IPM usam NÚMEROS DIFERENTES p/ a mesma fonte** (ex. "Atenção Média/Alta" = PIT `496` × LOA `01493`; "Emendas Bancada" = PIT `1017` × LOA `01527`) → o de/para só casa **por DESCRIÇÃO** (normalizada + difflib), NUNCA por dígito. 24 fontes mapeadas (97,2% do empenhado); 4 sem par na LOA (001 Tesouro Descentralizado, 1005/1006 Transf. Voluntárias, 1011 Outros Programas — execução por fora da LOA) ficam com o código PIT. Tabela `DEPARA_FONTE` no script.
- ⚠️ **Pegadinha do filtro de entidade**: `nmEntidade.includes('MUNIC')` casa "CÂMARA **MUNIC**IPAL" e "INTER**MUNIC**IPAL" (CISLIPA) → inflava 474,67→489,53mi. Usar `includes('MUNICÍPIO')` (com acento) isola a Prefeitura.
- Migração one-time (guarda: aborta se já houver dotação com orçado E empenhado): apaga as dotações da execução paralela (as com empenho CAP-*), reescreve empenhado sobre as dotações da LOA. Resultado: 411 orçado+empenhado · 886 só-orçado · 32 só-empenho (sem LOA); Σ orçado 1.105.490.611,74 e Σ empenhado 474.671.976,49 ao centavo.
## CÂMARA reconciliada ✅ — `importar_camara_paranagua.ts`
A Câmara não expõe QDD-com-fonte no portal IPM (só relatórios por natureza/modalidade). MAS a Câmara tem **UO/função/subf/programa/ação/fonte ÚNICOS** (01.001/01/031/0001/2000/fonte **001**) — só a natureza varia (15 elementos). Então o CSV "despesa por elemento" (`Relatorio (4).csv`: colunas Categoria/Grupo/**Elemento**/Código/Prevista/Liquidado) casa **1:1** com a execução agregada ao elemento, SEM ambiguidade de fonte/ação. Natureza = Código (cat.grp.mod, dropa "3") + coluna Elemento. Resultado: 31 dotações (15 orçado+empenhado, 16 só-orçado) · **Σ orçado 53.900.000,00 · Σ empenhado 10.372.853,82** ao centavo. **Lei nº 4.634/2025** (o .doc da LOA) confirma: total 1.399.578.700,00 · Câmara (Poder Legislativo) 53.900.000 · +CAGEPAR 5.578.300 (água, é entidade de Paranaguá) · Previdência despesa 173.247.000. O detalhamento com fonte da lei está em "quadros anexos" (planilhas separadas, não no .doc).

## PREVIDÊNCIA reconciliada ✅ — `importar_previdencia_paranagua.ts`
A Previdência TEM QDD-com-fonte no portal (`Relatorio (5).csv`, mesmo formato da Prefeitura). Script COMBINADO (import QDD + reconciliação numa tacada) com **de/para de fonte DINÂMICO por descrição + FUZZY (Jaccard ≥ 0,6)** — necessário porque "Regime Próprio…**– RPPS**" (PIT) vs "…Social" (LOA) e "**Reservas**"×"Reserva" diferem por 1 token. As 4 fontes do RPPS casaram (040→01040, 100→01100, 1046→01046, 1049→01049). Resultado: 116 dotações (24 orçado+empenhado, 92 só-orçado) · **Σ orçado 173.427.000,00 · Σ empenhado 19.401.291,13** ao centavo. (Padrão reusável p/ qualquer entidade com QDD-com-fonte: é o pipeline Prefeitura num script só, de/para dinâmico.)

O script combinado é GENÉRICO (args `--nome`/`--pit-match`/`--csv`): reusado p/ a **Fundação de Assist. à Saúde** (QDD `Relatorio (6).csv`, órgão 38/FASP, fonte única 01677) — SEM execução (não está no PIT) → só orçado **21.282.068,89** ao centavo.

## ARRECADAÇÃO (receita realizada) ✅ — `importar_arrecadacao_paranagua.ts`
Do "Balanço Orçamentário da Receita" (IPM, **.xls** → converter c/ `libreoffice --headless --convert-to xlsx`; xls2csv ESTRAGA códigos de 19 díg p/ notação científica — usar exceljs). Seta `valorArrecadado` nas PrevisaoReceita (agregando a conta analítica do balanço à previsão pai por maior-prefixo-pontuado; código = mesmo mapeamento da receita). Genérico via `--xlsx`/`--balanco-ent`/`--ent-nome`. Gravado: Pref **624,76mi** · Prev **130,26mi** · Fundação **17,43mi** (+3,4mi da Fundação sem previsão = repasse não-orçado). 🐛 LIÇÃO: NÃO fazer detecção de folhas por código — as linhas do balanço já são **DISJUNTAS** (Σ TODAS = receita líquida ao centavo, 1.282.085.954,72); o valor pode estar no nível "sintético" com filhas ZERADAS, então filtrar folhas descartava o IRRF de 454mi. Somar TODAS. (`Relatorio (7)/(8)` eram receita PREVISTA redundante; a arrecadada veio nos `.xls`/`(1)/(2)/(3).xlsx`.)

## DEDUÇÃO FUNDEB ✅ — `deducao_fundeb_paranagua.ts`
Previsão estava BRUTA, arrecadada saiu LÍQUIDA (balanço subtrai o FUNDEB dentro das transf 1.7.1/1.7.2). Ajuste: re-brutou a arrecadada das transf (+ FUNDEB de volta) + criou conta redutora `9.7.1.0…` "(-) Deduções da Receita para Formação do FUNDEB" (prevista −68.814.800 da LOA; arrecadada −36.842.062,44 = 9171*+9172* do balanço). Σ prevista da Prefeitura agora **1.282.085.954,72 LÍQUIDA** (= receita líquida oficial); Σ arrecadada intacta. As demais deduções do balanço (restituições IPTU/ISS/ICMS, outras linhas "9…") seguem netadas nas suas receitas (correto — retificações reais).

**ESTADO: PARANAGUÁ COMPLETA** (4 entidades: receita prevista(líquida)+arrecadada e despesa orçada+empenhada, ao centavo). **Follow-ups menores:** (1) onboard+import **CAGEPAR** (água; lei a inclui, 5,58mi); (2) commit/PR do bundle Paranaguá (pend. tree voltar ao master); (3) despesa da Câmara/Fundação está no elemento (o portal IPM não expõe QDD-com-fonte pra elas).

Relaciona: [[tce-pr-pit-dados-abertos]], [[maringa-municipio-completo]], [[coordenacao-sessoes]], [[portal-maringa-api-arquivos]] (contraste: Elotech tem API aberta; IPM é captcha-walled).
