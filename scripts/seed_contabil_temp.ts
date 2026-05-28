/**
 * Popula fixtures contábeis para inspeção visual local do fluxo completo:
 * modelo → estado → município → plano → contas (árvore) → lançamentos.
 *
 * Reaproveita os services para respeitar as invariantes (nível derivado do
 * parent, admiteMovimento só em folha, partida dobrada D=C, resumos mensais
 * atualizados na mesma transação).
 *
 * Idempotente — pode rodar várias vezes.
 *
 * Cleanup (remove só as fixtures do seed; preserva modelo e estado):
 *   npx tsx scripts/seed_contabil_temp.ts --remove
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'
import { ContasService } from '../src/services/contas.js'
import { LancamentosService } from '../src/services/lancamentos.js'
import { MunicipiosService } from '../src/services/municipios.js'
import { PlanosDeContasService } from '../src/services/planos-de-contas.js'

const MODELO_DESC = 'PARANÁ'
const ESTADO_SIGLA = 'PR'
const MUNICIPIO_NOME = 'Curitiba'
const ANO = 2026
const PLANO_DESC = `PCASP Estendido ${ANO}`

// [codigo, descricao, parentCodigo, admiteMovimento]. Ordem = pais antes de filhos.
const CONTAS: Array<[string, string, string | null, boolean]> = [
  ['1', 'ATIVO', null, false],
  ['1.1', 'ATIVO CIRCULANTE', '1', false],
  ['1.1.1', 'CAIXA E EQUIVALENTES DE CAIXA', '1.1', false],
  ['1.1.1.1', 'CAIXA', '1.1.1', true],
  ['1.1.1.2', 'BANCOS CONTA MOVIMENTO', '1.1.1', true],
  ['4', 'VARIAÇÕES PATRIMONIAIS AUMENTATIVAS', null, false],
  ['4.1', 'IMPOSTOS, TAXAS E CONTRIBUIÇÕES DE MELHORIA', '4', false],
  ['4.1.1', 'IMPOSTOS', '4.1', false],
  ['4.1.1.1', 'IPTU', '4.1.1', true],
]

async function remover(prisma: PrismaClient) {
  const estado = await prisma.estado.findUnique({ where: { sigla: ESTADO_SIGLA } })
  const municipio = estado
    ? await prisma.municipio.findFirst({ where: { nome: MUNICIPIO_NOME, estadoId: estado.id } })
    : null
  if (municipio) {
    await prisma.lancamento.deleteMany({ where: { municipioId: municipio.id } }) // cascade nos itens
    await prisma.resumoMensalConta.deleteMany({ where: { municipioId: municipio.id } })
    await prisma.saldoInicialAno.deleteMany({ where: { municipioId: municipio.id } })
  }

  const modelo = await prisma.modeloContabil.findUnique({ where: { descricao: MODELO_DESC } })
  const plano = modelo
    ? await prisma.planoDeContas.findUnique({
        where: { modeloContabilId_ano: { modeloContabilId: modelo.id, ano: ANO } },
      })
    : null
  if (plano) {
    // Folhas antes dos pais para não esbarrar na FK self-relation (Restrict).
    const contas = await prisma.conta.findMany({
      where: { planoId: plano.id },
      orderBy: { nivel: 'desc' },
    })
    for (const c of contas) await prisma.conta.delete({ where: { id: c.id } })
    await prisma.planoDeContas.delete({ where: { id: plano.id } })
  }
  if (municipio) await prisma.municipio.delete({ where: { id: municipio.id } })

  console.log('[seed-contabil] fixtures removidas (modelo e estado preservados).')
}

async function popular(prisma: PrismaClient) {
  const modelo = await prisma.modeloContabil.findUnique({ where: { descricao: MODELO_DESC } })
  if (!modelo) throw new Error(`Modelo "${MODELO_DESC}" não existe. Cadastre-o antes de rodar o seed.`)

  const estado = await prisma.estado.findUnique({ where: { sigla: ESTADO_SIGLA } })
  if (!estado) throw new Error(`Estado ${ESTADO_SIGLA} não existe (seed das 27 UFs não rodou?).`)
  if (!estado.modeloContabilId) {
    await prisma.estado.update({ where: { id: estado.id }, data: { modeloContabilId: modelo.id } })
  }

  // Município herda o modelo do estado (modeloContabilId omitido).
  const municipios = new MunicipiosService(prisma)
  let municipio = await prisma.municipio.findFirst({ where: { nome: MUNICIPIO_NOME, estadoId: estado.id } })
  if (!municipio) municipio = await municipios.criar({ nome: MUNICIPIO_NOME, estadoId: estado.id })

  const planos = new PlanosDeContasService(prisma)
  let plano = await prisma.planoDeContas.findUnique({
    where: { modeloContabilId_ano: { modeloContabilId: modelo.id, ano: ANO } },
  })
  if (!plano) plano = await planos.criar({ descricao: PLANO_DESC, ano: ANO, modeloContabilId: modelo.id })

  const contasSvc = new ContasService(prisma)
  const idPorCodigo = new Map<string, string>()
  for (const [codigo, descricao, parentCodigo, admiteMovimento] of CONTAS) {
    const existente = await prisma.conta.findUnique({
      where: { planoId_codigo: { planoId: plano.id, codigo } },
    })
    if (existente) {
      idPorCodigo.set(codigo, existente.id)
      continue
    }
    const parentId = parentCodigo ? idPorCodigo.get(parentCodigo) ?? null : null
    const conta = await contasSvc.criar({ planoId: plano.id, codigo, descricao, parentId, admiteMovimento })
    idPorCodigo.set(codigo, conta.id)
  }

  const caixa = idPorCodigo.get('1.1.1.1')!
  const bancos = idPorCodigo.get('1.1.1.2')!
  const iptu = idPorCodigo.get('4.1.1.1')!

  // criadoPorId é só uma string (sem FK); usa o admin de showcase se existir.
  const showcase = await prisma.usuario.findUnique({ where: { emailPrincipal: 'showcase@dev.local' } })
  const criadoPorId = showcase?.id ?? 'seed-contabil'

  const lancamentos = new LancamentosService(prisma)
  const jaTem = await prisma.lancamento.count({ where: { municipioId: municipio.id } })
  if (jaTem === 0) {
    await lancamentos.criar({
      municipioId: municipio.id,
      data: `${ANO}-03-10`,
      historico: 'Arrecadação de IPTU',
      criadoPorId,
      itens: [
        { contaId: caixa, tipo: 'DEBITO', valor: '1500.00' },
        { contaId: iptu, tipo: 'CREDITO', valor: '1500.00' },
      ],
    })
    await lancamentos.criar({
      municipioId: municipio.id,
      data: `${ANO}-04-05`,
      historico: 'Transferência de caixa para conta bancária',
      criadoPorId,
      itens: [
        { contaId: bancos, tipo: 'DEBITO', valor: '1000.00' },
        { contaId: caixa, tipo: 'CREDITO', valor: '1000.00' },
      ],
    })
    await lancamentos.criar({
      municipioId: municipio.id,
      data: `${ANO}-04-20`,
      historico: 'Arrecadação de IPTU',
      criadoPorId,
      itens: [
        { contaId: caixa, tipo: 'DEBITO', valor: '800.50' },
        { contaId: iptu, tipo: 'CREDITO', valor: '800.50' },
      ],
    })
  }

  console.log(
    `[seed-contabil] OK — modelo "${MODELO_DESC}", ${ESTADO_SIGLA}/${MUNICIPIO_NOME}, ` +
      `plano "${PLANO_DESC}", ${CONTAS.length} contas, ${jaTem === 0 ? 3 : jaTem} lançamentos.`,
  )
}

async function main() {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL não definida.')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  try {
    if (process.argv.includes('--remove')) await remover(prisma)
    else await popular(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('[seed-contabil] erro:', e)
  process.exit(1)
})
