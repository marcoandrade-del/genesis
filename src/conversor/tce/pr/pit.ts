import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import type { FonteExecucao, MunicipioConfig, EntidadeConfig, LinhaDespesa } from '../../nucleo/tipos.js'

/**
 * Fonte de EXECUÇÃO: PIT do TCE-PR (dados abertos, nível empenho). AGNÓSTICO de
 * fabricante — cobre todos os municípios do PR. Download direto por IBGE6:
 * https://pit.tce.pr.gov.br/Arquivos/{ano}/{ano}_{ibge6}_Despesa.zip
 *
 * Natureza agregada ao ELEMENTO (nível da LOA), p/ casar na reconciliação.
 * ⚠️ o XML é UTF-8 apesar da declaração iso-8859-1.
 */
const cent = (s: string | undefined): number => Math.round(parseFloat((s || '0').trim() || '0') * 100)

const cacheXml = new Map<string, string>()
async function empenhoXml(ano: number, ibge6: string): Promise<string> {
  const chaveMem = `${ano}_${ibge6}`
  const memo = cacheXml.get(chaveMem)
  if (memo) return memo
  const cacheZip = join(tmpdir(), `pit_${ano}_${ibge6}_Despesa.zip`)
  let buf: Buffer
  if (existsSync(cacheZip)) buf = readFileSync(cacheZip)
  else {
    const res = await fetch(`https://pit.tce.pr.gov.br/Arquivos/${ano}/${ano}_${ibge6}_Despesa.zip`)
    if (!res.ok) throw new Error(`download PIT falhou: HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(cacheZip, buf)
  }
  const zip = await JSZip.loadAsync(buf)
  const nome = Object.keys(zip.files).find((n) => /_Empenho\.xml$/.test(n))
  if (!nome) throw new Error('Empenho.xml não encontrado no ZIP do PIT')
  const s = await zip.files[nome]!.async('string')
  const xml = s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
  cacheXml.set(chaveMem, xml)
  return xml
}

const chave = (l: LinhaDespesa): string =>
  `${l.orgao.codigo}.${l.unidade.codigo}|${l.funcao}|${l.subfuncao}|${l.programa.codigo}|${l.acao.codigo}|${l.naturezaPcasp}|${l.fonte.codigo}`

export const pitTcePr: FonteExecucao = {
  nome: 'TCE-PR/PIT',
  async lerExecucao(cfg: MunicipioConfig, ent: EntidadeConfig): Promise<LinhaDespesa[]> {
    if (!ent.matchPit) return []
    const xml = await empenhoXml(cfg.ano, cfg.ibge)
    const agg = new Map<string, LinhaDespesa>()
    for (const m of xml.matchAll(/<Empenho ([^>]*?)\/>/g)) {
      const a: Record<string, string> = {}
      for (const at of m[1]!.matchAll(/([A-Za-z]+)="([^"]*)"/g)) a[at[1]!] = at[2]!
      if (!(a.nmEntidade || '').includes(ent.matchPit)) continue
      const t = (s: string | undefined) => (s || '').trim()
      const linha: LinhaDespesa = {
        orgao: { codigo: t(a.cdOrgao), nome: t(a.nmOrgao) },
        unidade: { codigo: t(a.cdUnidade), nome: t(a.nmUnidade) },
        funcao: t(a.cdFuncao),
        subfuncao: t(a.cdSubFuncao),
        programa: { codigo: t(a.cdPrograma) },
        acao: { codigo: t(a.cdProjetoAtividade), nome: t(a.dsProjetoAtividade) },
        naturezaPcasp: `${t(a.cdCategoriaEconomica)}.${t(a.cdGrupoNatureza)}.${t(a.cdModalidade)}.${t(a.cdElemento)}.00.00`,
        fonte: { codigo: t(a.cdFontePadrao), descricao: t(a.dsFontePadrao) },
        empenhado: 0,
        liquidado: 0,
        pago: 0,
      }
      const k = chave(linha)
      const g = agg.get(k)
      const alvo = g ?? (agg.set(k, linha), linha)
      alvo.empenhado = (alvo.empenhado ?? 0) + cent(a.vlEmpenho)
      alvo.liquidado = (alvo.liquidado ?? 0) + cent(a.vlLiquidacao)
      alvo.pago = (alvo.pago ?? 0) + cent(a.vlPagamento)
    }
    return [...agg.values()]
  },
}
