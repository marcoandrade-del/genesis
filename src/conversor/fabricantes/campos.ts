import type { TipoEntidade } from '../nucleo/tipos.js'

/**
 * Descritor dos CAMPOS de configuração que cada FABRICANTE precisa para converter
 * um município — o que a tela de cadastro/upload deve pedir. Espelha os `params`
 * que o conector daquele fabricante lê (ver fabricantes/<f>/conector.ts).
 *
 * `escopo`:
 *   - 'municipio' → arquivo/valor compartilhado por todas as entidades (ex.: o
 *      export único da receita, separado por `matchArquivo` em cada entidade);
 *   - 'entidade'  → específico de cada entidade (arquivo próprio ou discriminador).
 */
export type CampoConversor = {
  chave: string // chave em `params` (ex. 'receitaCsv')
  label: string
  tipo: 'arquivo' | 'texto'
  escopo: 'municipio' | 'entidade'
  accept?: string // extensões aceitas no <input type=file>
  ajuda?: string
}

export type FabricanteInfo = {
  chave: string // deve casar com a chave do conector em fabricantes/registry.ts
  nome: string
  campos: CampoConversor[]
}

/**
 * Fabricantes com conector + descritor de campos. A tela de cadastro oferece
 * estes como opções; o conector correspondente precisa existir no registry.
 */
export const fabricantesConversor: Record<string, FabricanteInfo> = {
  ipm: {
    chave: 'ipm',
    nome: 'IPM (atende.net)',
    campos: [
      {
        chave: 'receitaCsv',
        label: 'Orçamento da Receita (CSV)',
        tipo: 'arquivo',
        escopo: 'municipio',
        accept: '.csv',
        ajuda: 'Export único "Orçamento da Receita" (escada) — traz todas as entidades; cada uma é separada pelo identificador abaixo.',
      },
      {
        chave: 'matchArquivo',
        label: 'Identificador nos arquivos',
        tipo: 'texto',
        escopo: 'entidade',
        ajuda: 'Substring da coluna Entidade que distingue esta entidade nos arquivos (ex. MUNICIPIO, PREVIDENCIA, FUNDA).',
      },
      {
        chave: 'arrecadacaoXlsx',
        label: 'Balanço da Receita / arrecadação (XLSX)',
        tipo: 'arquivo',
        escopo: 'entidade',
        accept: '.xlsx',
        ajuda: '.xls do balanço convertido para .xlsx (libreoffice --convert-to xlsx).',
      },
      {
        chave: 'despesaQdd',
        label: 'Orçamento da Despesa / QDD (CSV)',
        tipo: 'arquivo',
        escopo: 'entidade',
        accept: '.csv',
      },
    ],
  },
  elotech: {
    chave: 'elotech',
    nome: 'Elotech (Portal da Transparência)',
    campos: [
      {
        chave: 'idPortal',
        label: 'ID da entidade no portal',
        tipo: 'texto',
        escopo: 'entidade',
        ajuda: 'Identificador da entidade na API do portal (ex. 1 = Prefeitura, 6 = Câmara). A URL base da API vai no campo "portal" do município (…/portaltransparencia-api).',
      },
    ],
  },
  betha: {
    chave: 'betha',
    nome: 'Betha (Transparência Cloud)',
    campos: [
      {
        chave: 'dadosAbertosUrl',
        label: 'URL base do dados-abertos',
        tipo: 'texto',
        escopo: 'municipio',
        ajuda: 'Base do dados-abertos do portal (valor de "urlDadosAbertos", host dados.transparencia.betha.cloud/…). A leitura é por API aberta, sem token — sem upload de arquivos.',
      },
      {
        chave: 'consultaReceita',
        label: 'ID da consulta de Receita',
        tipo: 'texto',
        escopo: 'entidade',
        ajuda: 'Id do dataset de receita orçamentária no dados-abertos desta entidade (usado em /api/consulta/{id}?formato=json).',
      },
      {
        chave: 'consultaDespesa',
        label: 'ID da consulta de Despesa',
        tipo: 'texto',
        escopo: 'entidade',
        ajuda: 'Id do dataset de despesa orçamentária / QDD no dados-abertos desta entidade.',
      },
    ],
  },
}

/** Tipos de entidade oferecidos no cadastro (rótulos amigáveis). */
export const tiposEntidade: { valor: TipoEntidade; label: string }[] = [
  { valor: 'PREFEITURA', label: 'Prefeitura' },
  { valor: 'CAMARA', label: 'Câmara' },
  { valor: 'ADM_INDIRETA', label: 'Adm. indireta (autarquia/fundação/RPPS)' },
]
