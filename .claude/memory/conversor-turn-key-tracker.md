---
name: conversor-turn-key-tracker
description: "Tracker do épico 'importação turn-key': meta 100% dos dados pelo PORTAL da entidade (sem SICONFI, sem download manual); quadro de proveniência por entidade × tipo de dado + dificuldade, ticando um a um"
metadata: 
  node_type: memory
  type: project
  originSessionId: 33369826-8471-4e55-bfce-06b40346017c
---

# Épico turn-key: 100% dos dados pelo PORTAL da entidade

**Meta do Marco (2026-07-20):** toda entidade com dados vindos do **portal da própria entidade**, AUTOMATIZADO — **sem recorrer ao SICONFI e sem download manual de arquivos**. Interino: enquanto não chega lá, EXPOR o dado minerado do SICONFI (não deixar zerado) e ANOTAR a proveniência + dificuldade. Ticar entidade por entidade.

Arquitetura já existe (80%): `src/conversor/` — contrato `ConectorFabricante` (`lerReceita`/`lerDespesa`, `nucleo/tipos.ts`), `importarMunicipio()` orquestrador, núcleo compartilhado (onboarding, escreverReceita/Despesa, reconciliar, de-para-fonte), models `ConversorMunicipio/Entidade`, UI `/conversor`. **Os 4 conectores existem** (`fabricantes/{elotech,ipm,betha,siconfi}/conector.ts`). **SICONFI/Betha rodam pelo pipeline; Elotech+IPM NÃO — os dados reais do dev vieram dos meus scripts avulsos** (`scripts/importar_*_maringa*.ts`, `scripts/importar_*_paranagua*.ts`), que fazem coisas fora do conector (duodécimo/evento 900, CAGEPAR, FUNDEB, reconciliação c/ provisionamento). O épico = fazer Elotech+IPM rodarem pelo pipeline, validar ao centavo, aposentar os scripts. Ver [[conversor-arquitetura-fabricante]], [[maringa-municipio-completo]], [[import-paranagua-ipm]].

## Dificuldade por fabricante (portal automatizado)
- **Elotech (Maringá): BAIXA.** Portal = API HTTP aberta (`transparencia.<mun>.pr.gov.br/portaltransparencia-api`). Conector `fabricantes/elotech/portal.ts` já lê `/api/receitas/fonte-recursos` (previsto+arrecadado) + `/api/despesas` (QDD). Rodar `importarMunicipio` provavelmente já preenche tudo.
- **Betha (Criciúma): MÉDIA.** API dados-abertos + busca-textual. Receita fechada (#263). Despesa dimensional (programa/ação) NÃO sai limpa (174485 é histórico multi-ano sem exercício/programa) → hoje é SICONFI.
- **IPM (Paranaguá): ALTA.** atende.net grid = **anti-bot (headless 000549)**; hoje tudo por export MANUAL do Marco. Automatizar: (1) PDF por `GET /ged/r/{idAnexo}` (funcionou p/ o duodécimo #273); (2) handshake da "Janela" IPM (criar-tela via `processo` antes de puxar linhas — e67b9139 chegou perto); (3) `dados_abertos` rotina 50047 onde `dados_abertos:1`.
- **SICONFI:** API nacional automatizada, MAS é o fallback A ELIMINAR (não tem programa/ação/UO).
- **PIT/TCE-PR:** execução (empenho/liq/pag) por zip automatizado — mas é TCE, não o portal da entidade. Questão aberta: conta como "portal" ou buscar execução no portal também?

## QUADRO por entidade (⬜=falta · ✅=portal automat. · 🅜=portal manual · 🔒=correto ser 0 · Ⓢ=SICONFI interino · Ⓟ=PIT)
### Maringá/PR (Elotech) — dificuldade BAIXA
| Entidade | RecPrev | RecArrec | DespOrç | DespExec | Duodécimo |
|---|---|---|---|---|---|
| Prefeitura | ✅ | ✅ | ✅ | Ⓟ | n/a |
| Previdência | ✅ | ✅ | ✅ | Ⓟ | n/a |
| Câmara | 🔒 | — | ✅ | Ⓟ | ⬜ verificar endpoint repasse |
| AMR | ⬜ prev=0 | ✅ | ✅ | Ⓟ | n/a |
| IAM | ⬜ prev=0 | ✅ | ✅ | Ⓟ | n/a |
| IPPLAM | ⬜ prev=0 | ✅ | ✅ | Ⓟ | n/a |

### Paranaguá/PR (IPM) — dificuldade ALTA
| Entidade | RecPrev | RecArrec | DespOrç | DespExec | Duodécimo |
|---|---|---|---|---|---|
| Prefeitura | 🅜 | 🅜 | 🅜 | Ⓟ | n/a |
| Previdência | 🅜 | 🅜 | 🅜 | Ⓟ | n/a |
| Fundação | 🅜 | 🅜 | 🅜 | 🔒 | n/a |
| Câmara | 🔒 | 🔒 | 🅜 | Ⓟ | ✅ /ged/r/ (#273) |
| CAGEPAR | ⬜ Ⓢ? | ⬜ Ⓢ? | ⬜ Ⓢ? | Ⓟ | n/a |

### Criciúma/SC (Betha) — MÉDIA — *(outra sessão)*
Pref/RPPS: receita ✅ portal Betha (#263); **despesa orç+exec = Ⓢ SICONFI** (alvo: Betha). Câmara: duodécimo ⬜.
### Paranaguá (SICONFI) — *(outra sessão, duplicata IPM)* · Vazios: Cianorte/Curitiba/Naviraí/Sarandi/Vilhena (⬜ stubs?)

## Bloqueios reais pro 100% portal
1. **IPM grid anti-bot (`000549`) — MURO DEFINITIVO (2026-07-21):** crackei o handshake da Janela (401→resolvido com a **sessão + referer do IFRAME** `/embed/data/<b64>/item/`; replay via fetch chega no endpoint) MAS o `000549` bloqueia a consulta mesmo com a requisição **byte-a-byte idêntica** ao browser, numa sessão limpa de 3 requests (não é fingerprint, não é handshake, não é rate — é detecção server-side de automação, mesmo via curl, do mesmo IP que o browser do Marco passa). **O grid granular (LOA/arrecadação por natureza) NÃO é automatizável.** `/ged/r/` (PDFs) destrava só duodécimo/decretos/prestação-de-contas. Granular = export manual até o `000549` ceder (o replay do handshake está pronto se ceder). ⭐ Técnica: `getFormularioExigeCaptchaAjax` (rot 1211) é o check de captcha; a consulta = `processaDados rot<R>/aca101` no iframe.
2. **DECRETOS do Paranaguá — NÃO PRECISA (Marco, 2026-07-21):** verifiquei antes de vasculhar os 1013 PDFs — o CSV de despesa que o Marco exportou (`Relatorio (1).csv`, Total 1.105.490.611,74) **já é o QDD ATUALIZADO** (col. "Recursos Exercício Anterior" = 52.118.764,24 = superávit financeiro = créditos já aplicados; o portal mostra o corrente). Parsear os decretos DUPLICARIA. Dev tem 0 CreditoAdicional (falta segregação inicial-vs-crédito), mas o **total autorizado está correto** e o Paranaguá IPM é scaffold (sem razão contábil completo) → segregação desnecessária. **Decretos do Paranaguá = descartados.**
3. **Betha despesa dimensional** — 174485 sem programa/ação por ano.
4. **CAGEPAR — GAP ACEITO/FECHADO (Marco, 2026-07-21):** orçado/receita NÃO têm fonte granular acessível. **SICONFI descartado:** o MSC de Paranaguá tem só 3 poder_orgao (10131 exec / 10132 prev / 20231 câmara) e SEM dimensão de órgão/UO — CAGEPAR está **consolidada no executivo 10131, inseparável** (nenhum campo/marcador a identifica). Portal IPM não expõe QDD dela (Marco não achou entidade própria no atende.net). Lei 4.634/2025 dá só o TOTAL (5.578.300, sem granular). PIT dá só execução (2.186.091,54, já no dev). **Decisão: deixar CAGEPAR só com a execução; orçado/receita = gap documentado, NÃO re-investigar.**
5. **Execução via PIT** — automat. mas não é o portal (decisão pendente; aceito como fonte oficial).

## Elotech (Maringá) — API do portal DECIFRADA (2026-07-20)
Base `https://transparencia.maringa.pr.gov.br/portaltransparencia-api`. Endpoints:
- `/api/receitas/fonte-recursos?entidade=<idPortal>&exercicio=<ano>` → fontes c/ `valorOrcado` **E `valorArrecadado`** (o tipo no código omitia o arrecadado).
- `/api/receitas/fonte-recursos/detalhes?...&fonteRecurso=<f>` → linhas natureza×fonte (orçado+arrecadado).
- **`/api/receitas?entidade=&exercicio=`** = endpoint RICO (árvore de natureza c/ `valorArrecadado/Empenhado/Liquidado/Pago`, `repasseRecebido/Concedido`, deduções) — o conector NÃO usa.
- `/despesapornivel/detalhada?dataInicial=&dataFinal=` (header `entidade`+`exercicio`) → QDD, nível-11 `valorPrevisto` = **dotação INICIAL** (não autorizado).
- **`repasseRecebido`/`repasseConcedido` SEMPRE 0** (testei Câmara/AMR/IAM/Pref); `/api/transferencias-financeiras`,`/api/repasses` = 404/500. **→ o duodécimo NÃO é obtível pelo portal Elotech.**
- idPortal: 1=Pref · 6=Câmara · 3=Previdência · 9=AMR · 15=IPPLAM · 4=IAM.

**Legislação confirmada:** Câmara NÃO tem receita orçamentária (correto prev=0; duodécimo=transf.financeira, fora do portal). Autarquias TÊM receita própria (taxas/remuneração/FUNDEMA) mas NÃO orçam (prev=0 correto); a **arrecadada é real e está no portal**.

**QDD portal (inicial) × dev (autorizado):** Pref portal 2.842.650.399,00 (inicial) × dev 3.381.347.898,63 (autorizado) = +719.567.209,57 créditos SUPLEMENTAR (229 decretos) − 180.869.709,94 anulações. **O conector traz só o inicial; falta plugar os decretos** (`decretos-solver.ts`, já existe).

## Progresso (ticar aqui)
- ✅ **Paranaguá IPM Câmara duodécimo** — evento 900 via `/ged/r/` PDF, PORTAL automatizado (#273 mergeado).
- ✅ **Maringá autarquias arrecadada (própria) — PORTAL automatizado** (fix do filtro do conector Elotech, `5aef518` na branch `feat/elotech-conector-arrecadada`; IAM 1.626.907,23 / IPPLAM 11.859,37 = dev ao centavo). prev=0 é CORRETO (não orçam).
- ✅ **Maringá créditos adicionais (decretos) → autorizado — PLUGADO no pipeline** (`5c4a9ce`, branch `feat/elotech-conector-arrecadada`). `ConectorFabricante += sincronizarCreditos?()` (opcional/aditivo); `SincronizacaoDecretosService` config-driven (portalUrl+entidadePortal); Elotech implementa; `importarMunicipio` chama na fase-2. 3725 testes verdes. NÃO re-rodado no dev (autorizado já correto). **Elotech agora ~99% turn-key** (LOA+arrec+créditos+execução via pipeline).
- ✅ **Maringá Câmara duodécimo — RESOLVIDO (NÃO era dead-end!):** o repasse NÃO está na API de receita (`repasseRecebido`=0), MAS está em **`GET /api/repasses?tipo=R&mesInicial=01&mesFinal=12`** com **header `entidade=<idPortal>`**, campo **`valorLancado`** (recebido YTD). Descoberto via **`/actuator/mappings`** (Spring actuator, 200 — lista as 700 rotas!) + a XHR da tela `/portaltransparencia/<id>/repasses-receita/receita`. `tipo=R`=Recebido. Booked como transf. financeira (evento 900) — **Câmara Maringá 36.079.003,50** no razão (Caixa+/VPA credor), receita orç.=0. `scripts/importar_transferencias_camara_maringa.ts` (PR #275). **Repasse de TODAS as ent. transfer-financiadas disponível:** AMR previsto 2,18mi/lançado 779k · IAM 20,31mi/4,58mi · IPPLAM 5,79mi/2,65mi · Prev 227,14mi/59,1mi (aporte RPPS — caso especial). Marco escolheu SÓ a Câmara por ora.
- 🏁 **ELOTECH/MARINGÁ = 100% PELO PORTAL, AUTOMATIZADO:** receita+arrec (todas ent.) + QDD + créditos + execução (PIT) + duodécimo. Zero export manual, zero SICONFI.
- ⬜ Elotech: rodar o município INTEIRO por `importarMunicipio` (--apply, com OK) e provar ao centavo vs dev; aposentar scripts avulsos.
- 💡 **Técnica reusável: `/actuator/mappings`** nos portais Elotech (Spring Boot) expõe TODAS as rotas da API — usar p/ decifrar endpoints não-óbvios (repasses, etc.).
- ⬜ IPM/Paranaguá: automatizar via `/ged/r/` + handshake da Janela (hoje manual).
- (Criciúma/Betha, vazios: pendentes/outra sessão)

**Escopo de sessão (aguardando confirmação do Marco):** provável foco em Maringá (Elotech) + Paranaguá IPM (meus); Criciúma/SICONFI são de outras sessões. `src/conversor/` é território da sessão SICONFI — mudar de forma ADITIVA (sem quebrar SICONFI/Betha).
