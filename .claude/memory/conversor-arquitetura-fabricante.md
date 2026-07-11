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

## Estado (2026-07-11) — CONVERSOR COMPLETO E VALIDADO ✅
- **PR #229** = POC bespoke do Paranaguá (IPM) — scripts `*paranagua*`.
- **PR #232** = ✅ CONVERSOR COMPLETO (`src/conversor/`, 10 testes verdes):
  - `nucleo/`: tipos+interfaces, pcasp, de-para-fonte, **onboarding**, **escrever-receita** (cria conta/fonte sob demanda), **escrever-despesa** (resolve dimensões + ledger CAP-*/MovimentoEmpenho), **reconciliar** (funde orçado LOA × empenhado TCE por descrição).
  - `fabricantes/ipm/`: `codigo` (decode→PCASP) + `layouts` (receita escada, despesa QDD, balanço arrecadação .xlsx) + `conector`.
  - `tce/pr/pit.ts`: execução do PIT (agnóstico de fabricante).
  - `importar.ts` (orquestrador via registries) + `municipios/paranagua-pr.ts` (config).
- **VALIDADO dry**: o pipeline reproduz Paranaguá AO CENTAVO — Pref orçado 1.105.490.611,74 / empenhado 474.671.976,49 / previsão 1.350.900.754,72; Prev/Fundação idem. **Um município novo do MESMO fabricante = só um arquivo de config.**
## PRODUTIZAÇÃO — Painel de Conversão ✅ (1ª fatia, no #232)
Marco: o conversor tem que ser FEATURE do app, com visibilidade (o que converteu / de onde / o que falta / o que bate) — não Claude-driven. Feito:
- `src/conversor/selo.ts` — `calcularSelo(prisma, município, ano)` lê o banco e produz o Selo de Conversão (o que foi convertido por entidade + conferências reconciliação/completude + o que falta). Validado no Paranaguá (2/4: CAGEPAR sem receita/QDD; 450 dotações casadas, 48 só-empenho).
- `src/app/conversor.ts` + `src/views/app/conversor.ejs` — tela `/app/conversor` (padrão da tela Sincronização, Bootstrap 5.3). Renderizada e conferida com dados reais.
- Drill-down "o que não bate" (ressalvas: execução fora da LOA R$/entidade, sem QDD, sem receita) — FEITO, card no painel.
- Mockups aprovados (4 telas): Painel/Selo ✅ (com ressalvas). Faltam: **Cadastro+Upload**, Índice de municípios.
- **RETOMADA da produtização — próximo = CADASTRO + UPLOAD** (fecha o "usuário faz sozinho"): (a) infra de upload (`@fastify/multipart` — CHECAR se já está no projeto — + guardar arquivos ex. `data/conversor/<municipio>/`); (b) **config-as-data**: hoje o município é `.ts` (`src/conversor/municipios/paranagua-pr.ts`) → vira modelo Prisma + **MIGRAÇÃO** (⚠ `schema.prisma` é zona de colisão; coordenar pelo quadro, tree no master); (c) botão "Converter" que roda `importarMunicipio(prisma, cfg)`. Depois: Índice de municípios (read-only, reusa `calcularSelo`); conferência "Σ × lei oficial" (config traz alvos); persistir execuções (auditoria).
- **Como retomar:** sessão nova → "continuar o conversor / cadastro+upload". Estado: PR #229 (import Paranaguá) + PR #232 (conversor completo: framework + selo + painel). Nada pendente no disco além de MEMORY.md/quadro (que carregam sozinhos).

- **Follow-ups (framework):** (1) `fabricantes/elotech/` extraído do Maringá ([[maringa-municipio-completo]], [[portal-maringa-api-arquivos]]) → primeiro fabricante com portal-API; (2) layout "despesa por elemento" no IPM (Câmara — dimensão única, sem QDD-com-fonte); (3) dedução FUNDEB no núcleo (hoje receita sai BRUTA; o líquido/redutora é o `deducao_fundeb_paranagua`); (4) runner `scripts/converter-municipio.ts` + persistir (o `importarMunicipio` grava; a validação foi dry pra não mexer no bespoke).
