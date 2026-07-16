# Pedido à Elotech — de/para patrimonial (natureza → VPA/VPD) do PCASP

**O que precisamos:** a correlação, **por natureza**, entre a classificação orçamentária
e a conta **patrimonial** do PCASP — o "de/para" que o sistema de vocês já usa para
contabilizar a variação patrimonial no momento da realização da receita e da liquidação
da despesa. É a tabela que resolve, para cada natureza, qual conta de VPA (classe 4) ou
VPD (classe 3) é debitada/creditada.

**Por que:** estamos reproduzindo o razão contábil completo (MSC/Siconfi) e temos as classes
5-8 (orçamentário) fechando ao centavo, mas as classes 3-4 (VPD/VPA — o resultado
patrimonial) ainda não, porque o de/para natureza→conta patrimonial que temos é parcial e
grosso. Vocês têm o completo e fino.

**Ente de referência:** Prefeitura de Maringá, exercício 2026 (PCASP TCE-PR / SIM-AM).

---

## Tabela 1 — Receita → VPA (o mais crítico)

Uma linha por **natureza de receita** (no maior detalhe do ementário — todos os dígitos).

| Coluna | O que é | Exemplo |
|---|---|---|
| `natureza_receita` | código completo da natureza | `1.1.1.2.50.0.1` (IPTU) · `1.7.1.1.51...` (FPM) |
| `conta_vpa` | conta de **VPA** (classe 4) que a natureza credita | `4.1.1.2.1.02...` · `4.5.2.1.3.02...` |
| `reconhecimento` | **CAIXA** (VPA na arrecadação) ou **COMPETENCIA** (VPA no lançamento/constituição do crédito) | `COMPETENCIA` p/ tributos; `CAIXA` p/ transferências |
| `conta_ativo` | (só se COMPETENCIA) conta de **crédito a receber** (classe 1.1.2) constituída | `1.1.2.1.1.01.05...` |
| `conta_divida_ativa` | (só se COMPETENCIA) conta de **dívida ativa** (classe 1.2.1) | `1.2.1.1.1.04.01.01.05...` |

**Exemplo real (que já temos):**
```
1.1.1.2.50.0.1 | COMPETENCIA | 4.1.1.2.1.02... | 1.1.2.1.1.01.05... | 1.2.1.1.1.04.01.01.05...
1.7.1.1.51     | CAIXA       | 4.5.2.1.3.02... | (vazio)             | (vazio)
```

> **Prioridade:** as **transferências** (naturezas `1.7.x`, `2.4.x` — FPM, ICMS, FUNDEB,
> SUS, convênios) são as que mais faltam. Se puderem mandar só essas primeiro, já destrava
> a maior parte.

## Tabela 2 — Despesa → VPD

Uma linha por **natureza de despesa** (elemento/subelemento — o maior detalhe).

| Coluna | O que é | Exemplo |
|---|---|---|
| `natureza_despesa` | código da natureza de despesa | `3.1.90.11` (vencimentos) · `3.3.90.30` (material) |
| `conta_vpd` | conta de **VPD** (classe 3) debitada na liquidação | `3.1.1.1.1.01.01...` · `3.3.1.1.1.99...` |
| `conta_passivo` | conta de **passivo** (classe 2.1) creditada (obrigação a pagar) | `2.1.3.1.1.01.01...` |

**Exemplo real (que já temos):**
```
3.3.90.39 | 3.3.2.3.1.99... | 2.1.3.1.1.01.01...
3.1.90.11 | 3.1.1.1.1.01.01... | 2.1.1.x...
```

> **Granularidade:** o de/para atual mapeia grosso (todo `3.1.90.11` numa conta só de VPD),
> mas o oficial espalha nas sub-contas (vencimentos, adicionais, 13º…). Precisamos no nível
> **mais fino** que vocês tiverem (a sub-conta de VPD por subelemento).

---

## Formato

- **CSV ou XLSX**, uma aba por tabela (Receita e Despesa), com os cabeçalhos acima.
- Códigos **completos** (com os pontos, como no PCASP), no maior detalhe.
- Se houver variação por tipo de entidade/regime, mande a da **Prefeitura** (execução orçamentária).

Qualquer dúvida sobre uma coluna, é só perguntar — o objetivo é: para cada natureza,
saber exatamente qual conta patrimonial ela movimenta.
