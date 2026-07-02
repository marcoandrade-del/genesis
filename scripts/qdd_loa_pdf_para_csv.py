#!/usr/bin/env python3
"""
Extrai o QDD (Anexo XXIV — Quadro de Detalhamento da Despesa) do PDF da
LOA 2026 de Maringá (Lei 12.100) para CSV: uma linha por dotação × natureza
(elemento) × FONTE DE RECURSO — o de/para que o Portal da Transparência não
publica (todas as dotações importadas caíram na fonte sintética 9999).

O QDD cobre a administração direta (órgãos 01 Câmara → 29) e indiretas;
o import (importar_qdd_fontes_2026.ts) filtra o que casa com o banco.

Estrutura do texto (pdftotext -layout):
  01.010.01.031.0001.1301   NOME DA AÇÃO                    3.853.000,00   ← dotação
            3.3.90.39       OUTROS SERVICOS...                350.000,00   ← natureza
               1001         Recursos do Tesouro...            350.000,00   ← fonte
Linhas de rollup (órgão/função/…, com menos segmentos) e ruído de página
(cabeçalhos, rodapés, texto lateral do anexo) são ignorados.

Valida: Σ fontes == TOTAL do anexo (R$ 3.582.003.907,00), Σ fontes por
natureza == valor da natureza e Σ por dotação == valor da dotação.

Rodar: python3 scripts/qdd_loa_pdf_para_csv.py \
         [data/'Material didático'/'LOA 2026 Maringá.pdf'] [saida.csv]
"""

import csv
import re
import subprocess
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

PDF_DEFAULT = Path('data/Material didático/LOA 2026 Maringá.pdf')
CSV_DEFAULT = Path('data/qdd_loa_2026_maringa.csv')

TOTAL_ESPERADO = Decimal('3582003907.00')  # Art. 1º da Lei 12.100

RE_DOTACAO = re.compile(
    r'^(\d{2})\.(\d{3})\.(\d{2})\.(\d{3})\.(\d{4})\.(\d{4})\s+(.+?)\s{2,}([\d.]+,\d{2})\s*$'
)
RE_NATUREZA = re.compile(r'^(\d\.\d\.\d{2}\.\d{2})\s+(.+?)\s{2,}([\d.]+,\d{2})\s*$')
RE_FONTE = re.compile(r'^(\d{4,5})\s+(.+?)\s{2,}([\d.]+,\d{2})\s*$')
RE_TOTAL = re.compile(r'^TOTAL\s+([\d.]+,\d{2})\s*$')
RE_INICIO = re.compile(r'LOA - Quadro de Detalhamento da Despesa')

# ruído de página: cabeçalhos, rodapés e o texto lateral vertical do anexo
RUIDO = re.compile(
    r'www\.elotech|Página|CONTA/FONTE|PREFEITURA DO|Estado do Paraná'
    r'|Exercício|Anexo|XXIV|LOA|^\s*Despesa\s*$|^\s*\d{2}/\d{2}/\d{4}'
)


def brl(valor: str) -> Decimal:
    return Decimal(valor.replace('.', '').replace(',', '.'))


def main() -> None:
    pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else PDF_DEFAULT
    saida = Path(sys.argv[2]) if len(sys.argv) > 2 else CSV_DEFAULT

    with tempfile.NamedTemporaryFile(suffix='.txt') as tmp:
        subprocess.run(['pdftotext', '-layout', str(pdf), tmp.name], check=True)
        linhas = Path(tmp.name).read_text(errors='replace').splitlines()

    # delimita o anexo: do título até a linha TOTAL
    inicio = next(i for i, l in enumerate(linhas) if RE_INICIO.search(l))

    registros = []           # linhas do CSV
    dotacao = None           # contexto corrente: dict da dotação
    natureza = None          # contexto corrente: (código, nome, valor)
    soma_natureza = Decimal(0)
    soma_dotacao = Decimal(0)
    erros = []
    total_anexo = None

    def fecha_natureza():
        nonlocal soma_natureza
        if natureza and soma_natureza != natureza[2]:
            erros.append(
                f'natureza {natureza[0]} em {dotacao["dotacao"]}: '
                f'Σ fontes {soma_natureza} != {natureza[2]}'
            )
        soma_natureza = Decimal(0)

    def fecha_dotacao():
        nonlocal soma_dotacao
        fecha_natureza()
        if dotacao and soma_dotacao != dotacao['valor']:
            erros.append(
                f'dotação {dotacao["dotacao"]}: Σ fontes {soma_dotacao} != {dotacao["valor"]}'
            )
        soma_dotacao = Decimal(0)

    for linha in linhas[inicio:]:
        texto = linha.strip()
        if not texto:
            continue

        m = RE_TOTAL.match(texto)
        if m:
            total_anexo = brl(m.group(1))
            break

        m = RE_DOTACAO.match(texto)
        if m:
            fecha_dotacao()
            natureza = None
            orgao, unidade, funcao, subfuncao, programa, acao = m.groups()[:6]
            dotacao = {
                'orgao': orgao, 'unidade': unidade, 'funcao': funcao,
                'subfuncao': subfuncao, 'programa': programa, 'acao': acao,
                'dotacao': f'{orgao}.{unidade}.{funcao}.{subfuncao}.{programa}.{acao}',
                'nome': m.group(7).strip(), 'valor': brl(m.group(8)),
            }
            continue

        m = RE_NATUREZA.match(texto)
        if m and dotacao:
            fecha_natureza()
            natureza = (m.group(1), m.group(2).strip(), brl(m.group(3)))
            continue

        m = RE_FONTE.match(texto)
        if m and dotacao and natureza:
            valor = brl(m.group(3))
            registros.append({
                **{k: dotacao[k] for k in
                   ('orgao', 'unidade', 'funcao', 'subfuncao', 'programa', 'acao')},
                'dotacao_nome': dotacao['nome'],
                'natureza': natureza[0], 'natureza_nome': natureza[1],
                'fonte': m.group(1), 'fonte_nome': m.group(2).strip(),
                'valor': str(valor),
            })
            soma_natureza += valor
            soma_dotacao += valor
            continue

        # rollups (menos segmentos) e ruído: ignora; continuação de nome
        # (linha sem valor logo após fonte/natureza) também não carrega dado
        if not RUIDO.search(linha) and re.search(r'[\d.]+,\d{2}\s*$', texto):
            # linha com valor que nenhum padrão pegou e não é rollup conhecido
            # (rollups: órgão "01", órgão.unidade "01.010", …até programa)
            if not re.match(r'^\d{2}(\.\d{3}(\.\d{2}(\.\d{3}(\.\d{4})?)?)?)?\s', texto):
                erros.append(f'linha com valor não classificada: {texto[:100]}')

    fecha_dotacao()

    soma_geral = sum((Decimal(r['valor']) for r in registros), Decimal(0))
    chave_acao = ('orgao', 'unidade', 'funcao', 'subfuncao', 'programa', 'acao')
    pares = {tuple(r[k] for k in chave_acao) + (r['natureza'],) for r in registros}
    print(f'Registros (dotação×natureza×fonte): {len(registros)}')
    print(f'Ações distintas: {len({tuple(r[k] for k in chave_acao) for r in registros})}')
    print(f'Pares ação×natureza (grão das dotações no banco): {len(pares)}')
    print(f'Fontes distintas: {len({r["fonte"] for r in registros})}')
    por_orgao: dict[str, Decimal] = {}
    for r in registros:
        por_orgao[r['orgao']] = por_orgao.get(r['orgao'], Decimal(0)) + Decimal(r['valor'])
    print('Σ por órgão:')
    for o in sorted(por_orgao):
        print(f'  {o}: {por_orgao[o]:>20,.2f}')
    print(f'Σ geral: {soma_geral}  |  TOTAL do anexo: {total_anexo}  |  esperado: {TOTAL_ESPERADO}')
    if erros:
        print(f'\n⚠️ {len(erros)} inconsistências:')
        for e in erros[:20]:
            print('  -', e)
    if total_anexo != TOTAL_ESPERADO or soma_geral != TOTAL_ESPERADO:
        print('\n❌ soma não bate com o total da lei — CSV NÃO gravado')
        sys.exit(1)

    with saida.open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(registros[0].keys()))
        w.writeheader()
        w.writerows(registros)
    print(f'\n✅ {saida} gravado')


if __name__ == '__main__':
    main()
