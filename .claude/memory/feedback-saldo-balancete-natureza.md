---
name: feedback-saldo-balancete-natureza
description: "Saldo de conta no rollup do balancete deve ser SALDO DEVEDOR COM SINAL — credora/retificadora subtrai; nunca somar saldos \"positivos por natureza\""
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bebb6b7f-4392-45b6-8ab4-efdcefb3872a
---

No #81 (saldos do plano contábil) calculei o saldo de cada conta "positivo pela sua natureza" (devedora = inicial+D−C; credora = inicial+C−D) e no rollup **somei** os filhos. Num grupo com **conta retificadora/redutora** (credora sob o ativo — ex.: `(-) Depreciação Acumulada`, `(-) Juros a apropriar`), a redutora era SOMADA em vez de subtraída → saldo do grupo inflado. O Marco pegou na hora: "somou débito com crédito". Mandou estudar o MCASP.

**Why:** num balancete, o saldo de uma sintética é a soma dos filhos só se todos estiverem na MESMA convenção de sinal. Saldo devedor e saldo credor são lados opostos — somá-los como positivos é literalmente somar débito com crédito. Conta retificadora existe pra REDUZIR o grupo.

**How to apply:** trabalhe em **saldo devedor COM SINAL** (+ devedor, − credor). Em termos de débito, **todo débito soma e todo crédito subtrai** (universal, sem ramo por natureza no movimento); a natureza entra SÓ para dar o sinal do saldo inicial (credora entra negativa: `inicialDevedor = natureza==='CREDORA' ? −valor : valor`). Rollup = soma com sinal → redutora subtrai sozinha. Exiba `|saldo| + lado D/C` (saldo credor não é "negativo vermelho"). O razão de UMA conta analítica pode mostrar na natureza dela (não é rollup, sem bug). Ref.: MCASP 11ª ed. p.531 (natureza do saldo: devedora/credora/mista) + exemplos de depreciação como retificadora do ativo. Fix no PR #83. Relaciona com [[contabil-regras-orcamentario]] e [[salvar-erros-em-memoria]].
