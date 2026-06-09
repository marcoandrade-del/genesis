/**
 * Re-sincroniza as cópias de plano de contas (contábil/receita/despesa + fontes)
 * das entidades de um município com o MODELO atual do estado (TCE).
 *
 * Por que existe: a importação EM MASSA do modelo (scripts/importar_pcasp_2026.ts,
 * importar_orcamentario_2026.ts) usa `createMany` e NÃO passa pelo
 * `SincronizadorContas` — então entidades onboardadas antes da importação ficam
 * com cópias defasadas. A lógica de remediação vive em
 * `src/services/ressincronizador-modelo.ts` (reusada também pelos botões do admin);
 * este script é o atalho de linha de comando.
 *
 * Segurança: o service só recopia entidades 100% `origem=MODELO` e SEM execução;
 * entidades com desdobramento/execução são PULADAS (preservadas). Aqui o dry-run
 * apenas diferencia em memória e imprime — não grava. Para gravar: --apply
 *
 * Rodar:
 *   npx tsx scripts/ressincronizar_entidades_modelo.ts [--municipio=Maringá] [--uf=PR] [--ano=2026] [--apply]
 */

import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { RessincronizadorModelo } from '../src/services/ressincronizador-modelo.js'

const arg = (nome: string, def: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${nome}=`))
  return hit ? hit.slice(nome.length + 3) : def
}
const MUNICIPIO = arg('municipio', 'Maringá')
const UF = arg('uf', 'PR')
const ANO = Number(arg('ano', '2026'))
const APPLY = process.argv.includes('--apply')

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const estado = await prisma.estado.findUnique({ where: { sigla: UF } })
if (!estado) throw new Error(`Estado UF=${UF} não encontrado.`)
const municipio = await prisma.municipio.findFirst({
  where: { estadoId: estado.id, nome: { equals: MUNICIPIO, mode: 'insensitive' } },
})
if (!municipio) throw new Error(`Município "${MUNICIPIO}" (${UF}) não encontrado.`)
const modeloId = municipio.modeloContabilId ?? estado.modeloContabilId
if (!modeloId) throw new Error(`Município "${MUNICIPIO}" (e seu estado) não têm modelo contábil definido.`)
const modelo = await prisma.modeloContabil.findUnique({ where: { id: modeloId } })

console.log(`Município: ${municipio.nome}/${UF}   modelo: ${modelo?.descricao} (${modeloId})   ano: ${ANO}`)
console.log(`Modo: ${APPLY ? 'APPLY (vai gravar)' : 'DRY-RUN (não grava)'}\n`)

const [planoCont, planoRec, planoDesp, fontesModelo] = await Promise.all([
  prisma.planoDeContas.findFirst({ where: { modeloContabilId: modeloId, ano: ANO } }),
  prisma.planoContasReceita.findFirst({ where: { modeloContabilId: modeloId, ano: ANO } }),
  prisma.planoContasDespesa.findFirst({ where: { modeloContabilId: modeloId, ano: ANO } }),
  prisma.fonteRecurso.findMany({ where: { modeloContabilId: modeloId, ano: ANO } }),
])
const [nCont, nRec, nDesp] = await Promise.all([
  planoCont ? prisma.conta.count({ where: { planoId: planoCont.id } }) : Promise.resolve(0),
  planoRec ? prisma.contaReceita.count({ where: { planoId: planoRec.id } }) : Promise.resolve(0),
  planoDesp ? prisma.contaDespesa.count({ where: { planoId: planoDesp.id } }) : Promise.resolve(0),
])
console.log(`Modelo atual → contábil=${nCont}  receita=${nRec}  despesa=${nDesp}  fontes=${fontesModelo.length}\n`)

const entidades = await prisma.entidade.findMany({ where: { municipioId: municipio.id }, orderBy: { nome: 'asc' } })

if (!APPLY) {
  // Diferencia em memória (não grava). Mostra defasagem e se a entidade seria pulada.
  for (const ent of entidades) {
    const [cM, cD, rM, rD, dM, dD, fM, lanc, orc] = await Promise.all([
      prisma.contaContabilEntidade.count({ where: { entidadeId: ent.id, ano: ANO, origem: 'MODELO' } }),
      prisma.contaContabilEntidade.count({ where: { entidadeId: ent.id, origem: 'DESDOBRAMENTO' } }),
      prisma.contaReceitaEntidade.count({ where: { entidadeId: ent.id, ano: ANO, origem: 'MODELO' } }),
      prisma.contaReceitaEntidade.count({ where: { entidadeId: ent.id, origem: 'DESDOBRAMENTO' } }),
      prisma.contaDespesaEntidade.count({ where: { entidadeId: ent.id, ano: ANO, origem: 'MODELO' } }),
      prisma.contaDespesaEntidade.count({ where: { entidadeId: ent.id, origem: 'DESDOBRAMENTO' } }),
      prisma.fonteRecursoEntidade.count({ where: { entidadeId: ent.id, ano: ANO, origem: 'MODELO' } }),
      prisma.lancamento.count({ where: { entidadeId: ent.id } }),
      prisma.orcamento.count({ where: { entidadeId: ent.id } }),
    ])
    console.log(`▶ ${ent.nome} (${ent.tipo})`)
    console.log(`    atual: contábil ${cM}→${nCont} | receita ${rM}→${nRec} | despesa ${dM}→${nDesp} | fontes ${fM}→${fontesModelo.length}`)
    const desd = cD + rD + dD
    if (desd > 0 || lanc > 0 || orc > 0) {
      console.log(`    ⚠️  seria PULADA — desdobramentos=${desd}, lançamentos=${lanc}, orçamentos=${orc} (preservados).`)
    }
    console.log('')
  }
  console.log('Dry-run. Reexecute com --apply para gravar (usa o RessincronizadorModelo).')
} else {
  const resumo = await new RessincronizadorModelo(prisma).ressincronizarMunicipio(municipio.id)
  for (const e of resumo.entidades) {
    const det = e.status === 'ressincronizada'
      ? `contábil=${e.contabil} receita=${e.receita} despesa=${e.despesa} fontes=${e.fontes}`
      : (e.motivo ?? '')
    console.log(`  ${e.status === 'ressincronizada' ? '✅' : '⏭️ '} ${e.nome}: ${e.status} — ${det}`)
  }
  console.log(`\nResumo: ${resumo.ressincronizadas} ressincronizada(s), ${resumo.puladas} pulada(s), ${resumo.semModelo} sem modelo (de ${resumo.total}).`)
}

await prisma.$disconnect()
await pool.end()
