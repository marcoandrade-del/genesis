---
name: conversor-arquitetura-fabricante
description: "Arquitetura do conversor de dados de municípios organizada por FABRICANTE do software de gestão (Elotech/IPM/Betha/GovBR/Equiplano), não por município — cada fabricante tem centenas de clientes; direção do Marco p/ escalar p/ vários municípios"
metadata:
  node_type: memory
  type: project
  originSessionId: da9ed666-7da5-40c7-906d-5e887fa3f9a0
---

# Conversor por FABRICANTE (não por município) — direção do Marco (2026-07-10)

Marco: Elotech, IPM, Betha, Governança Brasil, Equiplano têm CADA UMA centenas de municípios clientes. O conversor tem que ser reutilizável **por fabricante**, senão cada município é do zero. Paranaguá (IPM) e Maringá (Elotech) foram feitos "na unha" = fase de DESCOBERTA; o aprendizado tem que virar CONECTOR.

## Dois eixos INDEPENDENTES (o pulo do gato)
1. **FABRICANTE** → fonte do ORÇAMENTÁRIO (previsão receita, dotação inicial, arrecadação). Cada um busca de um jeito e tem seus layouts/códigos: Elotech = portal API aberta; **IPM/atende.net = captcha-walled (Turnstile), dados via export CSV/XLS**; Betha/GovBR/Equiplano = descobrir.
2. **TCE do ESTADO** → fonte da EXECUÇÃO (empenho). **AGNÓSTICO de fabricante** — o PIT do TCE-PR traz a execução dos 399 municípios do PR, seja qual for o software. Cada estado tem seu portal de dados abertos (ver [[tce-pr-pit-dados-abertos]]).

Um município = config `{ibge, fabricante, estado, url_portal, entidades}`. O conversor escolhe conector-do-fabricante + fonte-do-TCE-do-estado.

## O truque que faz TUDO reusar: NORMALIZAR pro PCASP na borda do conector
Cada conector traduz os códigos CRUS dele → padrão **PCASP nacional** (natureza, fonte). Ex.: natureza IPM "drop-1º-dígito + fatia [1,1,1,1,2,1,1,2,2,2,2,2]" → "3.1.90.11". Depois da normalização, TUDO downstream é padrão e não sabe de qual fabricante veio: onboarding, writers (previsão/dotação/execução), reconciliação orçado×empenhado, **de/para de fonte por DESCRIÇÃO+fuzzy** (resolve a divergência de código entre fabricante e TCE — vale p/ qualquer par).

## Estrutura proposta
```
conversor/
  nucleo/       # agnóstico: onboarding, writers, reconciliar, de-para-fonte, normalizar-natureza
  tce/{pr,sc,...}/   # execução por estado (PIT etc.) — vale p/ qualquer fabricante
  fabricantes/
    ipm/        # layouts atende.net + decodificação (aprendido no Paranaguá) — ver [[import-paranagua-ipm]]
    elotech/    # portal API (extrair do Maringá) — ver [[maringa-municipio-completo]], [[portal-maringa-api-arquivos]]
    betha/ governanca/ equiplano/ ...
  municipios/   # SÓ config: paranagua-pr.ts {ibge, fabricante:'ipm', ...}, maringa-pr.ts {...'elotech'...}
```
Interface comum do conector: `listarEntidades / lerReceita / lerDespesa / lerArrecadacao` → devolvem linhas NORMALIZADAS (natureza/fonte em PCASP). O núcleo faz o resto.

## Custo de um município novo (depois do refactor)
- **Mesmo fabricante** → um arquivo de CONFIG (IBGE, URL, entidades). Minutos.
- **Fabricante novo** → UM conector (cru→normalizado). Núcleo/reconciliação/writers já existem.

## Estado / RETOMADA (2026-07-10)
- **PR #229** = POC bespoke do Paranaguá (IPM) — scripts `*paranagua*`, 5 entidades ao centavo.
- **PR #232** = ✅ FUNDAÇÃO do conversor construída e TESTADA (7 testes verdes):
  - `src/conversor/nucleo/tipos.ts` (contratos + interfaces `ConectorFabricante`/`FonteExecucao`)
  - `src/conversor/nucleo/{pcasp,de-para-fonte}.ts` (helpers + de/para fonte por descrição)
  - `src/conversor/fabricantes/ipm/codigo.ts` (decodificação IPM→PCASP)
- **PRÓXIMOS (tarefas #8–#11, sessão nova rende mais):**
  1. `nucleo/` **writers** (o maior): `garantirEntidade` (onboarding), `escreverPrevisoes`, `escreverDotacoes` (resolve dimensões UO/função/programa/ação/conta/fonte + upsert), `reconciliar` (usa `casarFontesPorDescricao`), `setarArrecadado`. EXTRAIR de `scripts/importar_*paranagua*` e `reconciliar_execucao_loa_paranagua`.
  2. `fabricantes/ipm/` **parsers**: `lerReceita` (staircase CSV), `lerDespesa` (QDD CSV), `lerArrecadacao` (balanço .xls→xlsx via libreoffice) → `LinhaReceita`/`LinhaDespesa` normalizadas (usam `codigo.ts`).
  3. `tce/pr/` **PIT**: baixar+parsear `Empenho.xml` → `LinhaDespesa` de execução (implementa `FonteExecucao`).
  4. `municipios/paranagua-pr.ts` (config) + `importar(municipio)` orquestrador. **VALIDAR:** re-rodar Paranaguá pela nova arquitetura, conferir que bate ao centavo com o import bespoke (os totais estão em [[import-paranagua-ipm]]).
  5. Depois: `fabricantes/elotech/` extraído do Maringá ([[maringa-municipio-completo]]).
