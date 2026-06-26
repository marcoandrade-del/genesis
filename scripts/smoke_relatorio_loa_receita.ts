/**
 * Smoke AO VIVO do Demonstrativo da Receita Orçada (LOA) contra o banco real.
 * Roda o roll-up real (ArrecadacoesService.resumo) + monta o HTML; com --pdf
 * <arquivo> também gera o PDF (Playwright) para inspeção visual.
 *
 *   npx tsx scripts/smoke_relatorio_loa_receita.ts
 *   npx tsx scripts/smoke_relatorio_loa_receita.ts --pdf /tmp/loa.pdf
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { ArrecadacoesService } from '../src/services/arrecadacoes.js'
import { SaldoOrcamentarioService } from '../src/services/saldo-orcamentario.js'
import { ProgramaTrabalhoService } from '../src/services/programa-trabalho.js'
import {
  montarReceitaPrevista,
  montarDespesaFixada,
  montarProgramaTrabalho,
  documentoPdf,
  formatarReais,
} from '../src/services/relatorio-orcamento.js'

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : null
}
const pdfPath = arg('--pdf')
const htmlPath = arg('--html')
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const log = (s = '') => console.log(s)

async function main() {
  // Entidade com LOA 2026 (a de Maringá importada tem previsões).
  const orc = await prisma.orcamento.findFirst({
    where: { ano: 2026, previsoes: { some: {} } },
    include: { entidade: { include: { municipio: { include: { estado: true } } } } },
  })
  if (!orc) throw new Error('Nenhum orçamento 2026 com previsões no banco.')
  const ent = orc.entidade

  const resumo = await new ArrecadacoesService(prisma).resumo(ent.id, 2026)
  log(`Entidade: ${ent.nome} (${ent.municipio.estado.sigla} · ${ent.municipio.nome}) — exercício 2026`)
  log(`temOrcamento: ${resumo.temOrcamento}`)
  log(`TOTAL receita prevista: R$ ${formatarReais(resumo.resumo.previsto)}`)
  log(`linhas por conta: ${resumo.porConta.length} · por fonte: ${resumo.porFonte.length}`)
  log('top categorias (nível 1):')
  resumo.porConta.filter((l) => l.nivel === 1).forEach((l) => log(`  ${l.codigo}  ${l.rotulo}: R$ ${formatarReais(l.previsto)}`))

  const corpo = montarReceitaPrevista({
    cabecalho: {
      entidadeNome: ent.nome,
      municipio: ent.municipio.nome,
      estado: ent.municipio.estado.sigla,
      ano: 2026,
      brasao: ent.brasao,
    },
    porConta: resumo.porConta,
    porFonte: resumo.porFonte,
    total: resumo.resumo.previsto,
  })
  log(`\n✔ HTML do demonstrativo: ${corpo.length} chars; contém título: ${corpo.includes('Demonstrativo da Receita Orçada')}`)

  if (htmlPath) {
    writeFileSync(htmlPath, documentoPdf('Receita Orçada 2026', corpo))
    log(`✔ HTML receita gravado: ${htmlPath}`)
  }

  // ── Despesa fixada ──────────────────────────────────────────────────────────
  const saldo = await new SaldoOrcamentarioService(prisma).calcular(ent.id, 2026)
  log(`\nTOTAL despesa fixada: R$ ${formatarReais(saldo.resumo.autorizado)}`)
  log(`cortes: ${saldo.porUnidade.length} UO · ${saldo.porFuncao.length} funções · ${saldo.porConta.length} naturezas · ${saldo.porFonte.length} fontes`)
  const corpoD = montarDespesaFixada({
    cabecalho: { entidadeNome: ent.nome, municipio: ent.municipio.nome, estado: ent.municipio.estado.sigla, ano: 2026, brasao: ent.brasao },
    porUnidade: saldo.porUnidade,
    porFuncao: saldo.porFuncao,
    porConta: saldo.porConta,
    porFonte: saldo.porFonte,
    total: saldo.resumo.autorizado,
  })
  log(`✔ HTML despesa: ${corpoD.length} chars; contém título: ${corpoD.includes('Demonstrativo da Despesa Fixada')}`)
  const htmlDespesa = arg('--html-despesa')
  if (htmlDespesa) {
    writeFileSync(htmlDespesa, documentoPdf('Despesa Fixada 2026', corpoD))
    log(`✔ HTML despesa gravado: ${htmlDespesa}`)
  }

  // ── Programa de trabalho (QDD) ──────────────────────────────────────────────
  const pt = await new ProgramaTrabalhoService(prisma).calcular(ent.id, 2026)
  log(`\nTOTAL programa de trabalho: R$ ${formatarReais(pt.total)} (deve bater com a despesa)`)
  log(`linhas (UO→função→subfunção→programa→ação): ${pt.linhas.length}`)
  const corpoP = montarProgramaTrabalho({
    cabecalho: { entidadeNome: ent.nome, municipio: ent.municipio.nome, estado: ent.municipio.estado.sigla, ano: 2026, brasao: ent.brasao },
    linhas: pt.linhas,
    total: pt.total,
  })
  log(`✔ HTML programa: ${corpoP.length} chars; contém título: ${corpoP.includes('Programa de Trabalho')}`)
  const htmlPrograma = arg('--html-programa')
  if (htmlPrograma) {
    writeFileSync(htmlPrograma, documentoPdf('Programa de Trabalho 2026', corpoP))
    log(`✔ HTML programa gravado: ${htmlPrograma}`)
  }

  if (pdfPath) {
    const { gerarPdf } = await import('../src/services/relatorio-pdf.js')
    const buf = await gerarPdf({
      corpoHtml: documentoPdf('Receita Orçada 2026', corpo),
      header: '<span></span>',
      footer:
        '<div style="font-size:8px;width:100%;text-align:center;color:#888">página <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      margemTopoMm: 12,
      margemRodapeMm: 16,
    })
    writeFileSync(pdfPath, buf)
    log(`\n✔ PDF gerado: ${pdfPath} (${(buf.length / 1024).toFixed(0)} KB)`)
  }
  log('\n✅ OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
