---
name: oxy-playbook-verificacao-narrativa
description: HANDOFF 2 p/ a sessão OXY Dashboards — o MÉTODO por trás das análises; bateria de verificações cruzadas (identidades contábeis auditáveis por máquina), armadilhas de dados reais e padrões de narrativa p/ gestor público
metadata:
  type: reference
---

# Playbook de verificação e narrativa — para a IA de análise do OXY

Complemento do [[oxy-manual-interpretacao-fiscal]] (aquele diz O QUE os números
significam; este diz COMO verificar antes de falar e COMO comunicar depois).
Destilado de uma semana de trabalho real com Maringá 2025/2026, onde CADA técnica
abaixo pegou um problema de verdade.

## 1. Bateria de verificações cruzadas (rode ANTES de qualquer análise)

Identidades contábeis que DEVEM fechar — são testáveis por máquina (o OXY pode
implementá-las como feature de "selo de consistência", não só como prompt):

| # | Identidade | Pegou o quê em Maringá |
|---|-----------|------------------------|
| V1 | Caixa: relação de contas = Balanço Financeiro = Balanço Patrimonial | fechou ao centavo (775.079.908,05) — vira selo verde |
| V2 | BF interno: Σ ingressos (V) = Σ dispêndios (X) | **FALHOU**: Δ 27,5mi = inscrição de RP zerada (doc gerado antes do fechamento) |
| V3 | RCL idêntica em RREO A3 × RGF A2 × prestação de contas | fechou |
| V4 | Nominal abaixo da linha = ΔDCL do período | fechou ao centavo (105.376.201,92) |
| V5 | Demonstrativo simplificado = Σ dos anexos-fonte | fechou (no Gênesis, por construção) |
| V6 | Balancete × Balanço do mesmo período | **FALHOU**: Δ 896.247,17 = 1 rubrica lançada entre as datas de geração |
| V7 | Consolidado ⊇ entidade (caixa consolidada ≥ caixa da prefeitura) | Δ 40mi = outras entidades (esperado, quantificar) |
| V8 | Δ entre fontes = 0 ou explicado item a item (decompor 100%) | Δ DCL viva×oficial: 4 parcelas nomeadas = 106,6mi exato |

**Regra do resíduo**: um Δ só está "explicado" quando a soma das causas nomeadas
bate com ele. "Diferenças de metodologia" sem número é resposta proibida.

## 2. Armadilhas de dados reais (aprendidas na prática)

- **Data de geração ≠ data-base**: docs Elotech carimbam geração no rodapé; dois
  docs do MESMO período gerados em dias diferentes divergem (V2/V6). Sempre citar
  as duas datas.
- **Revisões acontecem**: a DCL inicial 2026 de Maringá foi REVISADA entre o RGF
  3ºQ/2025 e o 1ºQ/2026 (Δ 2.690). Republicações substituem — usar sempre a mais
  recente e anotar a revisão.
- **APURADO × META × PROJEÇÃO**: o erro nº 1 de IAs analisando contas (documentado:
  resposta de IA misturou resultado apurado com meta da LDO). Todo número leva o
  carimbo de qual dos três é.
- **Sinais e convenções**: DCL negativa = boa; dedução negativa = atenção; estorno
  reduz; "nominal positivo" pode significar dívida CAINDO (convenção abaixo da
  linha). Nunca assumir — checar a convenção do demonstrativo.
- **Fontes de recurso têm 3–6 dígitos** (1000, 11045, 41687) e mudam de codificação
  entre safras (STN 2022+) — casar por de/para, nunca por prefixo cego.
- **Quadrimestre parcial**: mês corrente incompleto → toda análise diz "posição
  parcial até DD/MM". Comparar períodos IGUAIS (jan–jun com jan–jun).
- **Sazonalidade**: 13º infla pessoal em nov/dez; IPTU infla receita no 1º tri —
  tendência anualizada ingênua (média×12) erra; usar mesmo-período-ano-anterior.
- **PDF/relatório trunca colunas largas** — se o total do detalhe ≠ total do
  cabeçalho, desconfiar do parse antes de desconfiar da contabilidade.

## 3. Padrões de narrativa para o gestor público

- **Conclusão primeiro** ("TLDR executivo"), detalhe depois. O prefeito lê 3 linhas.
- **Semáforo com consequência**: não dizer só "51,4% — prudencial"; dizer o que a
  faixa IMPLICA ("acima do prudencial: vedado criar cargo/reajustar além da revisão
  anual — LRF art. 22 § único").
- **Projeção com honestidade**: "no ritmo de jan–jun, encerraria o ano em X" +
  premissa explícita + sazonalidade considerada.
- **Contexto comparativo**: mesmo período do ano anterior sempre; a variação
  interessa mais que o nível.
- **A frase-para-o-tribunal**: toda análise sensível termina com um parágrafo
  citável, com base legal, que o gestor pode usar textualmente (modelo no manual 1).
- **Vocabulário calibrado**: "indica/sugere/aponta" (nunca "garante"); "dentro do
  limite COM ressalvas" quando houver ressalvas; incerteza declarada é credibilidade.
- **O que NÃO dizer**: nunca prometer conformidade futura; nunca atribuir intenção
  ("manobra", "esconde"); divergência entre fontes se REPORTA com as datas, não se
  arbitra em silêncio.

## 4. ✅ SELO DE CONSISTÊNCIA — JÁ É FEATURE (aprovado e construído 2026-07-07)
`GET /memoriais/consistencia?entidadeId&ano` (contrato **1.10.0**) devolve
`{verificacoes[], selo:{aprovadas, avaliadas, total}}` — 8 identidades rodadas por
máquina (arrecadação razão×materializado, empenhado/liquidado razão×ficha×dotação,
equilíbrio LOA+créditos, dotações sem estouro, Anexo 6×fontes, sincronização OK).
**O OXY deve chamar ANTES da análise e exibir o selo "N de M"**; verificação
DIVERGENTE traz Δ + detalhe — a IA cita a divergência, nunca a esconde. Na base
real de Maringá: 6/8 com as 2 divergências sendo achados verdadeiros (assimetria
de escopo receita×QDD 327,6mi; 113 dotações estouradas pelo rateio da captura) —
demonstração perfeita do produto: o selo pega problemas reais.
