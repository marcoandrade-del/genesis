import { PrismaClient, Prisma } from '@prisma/client'
import { ErroNegocio } from '../errors.js'

const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v)
const ZERO = D(0)

export type Tipo = 'DEBITO' | 'CREDITO'

/** Conta filha a criar, com o saldo inicial que o usuário digitou. */
export type FilhoNovo = { codigo: string; descricao: string; saldoInicial: Prisma.Decimal }

/** Movimento (LancamentoItem) da conta-mãe no exercício. */
export type MovimentoMae = {
  itemId: string
  lancamentoId: string
  ano: number
  mes: number
  tipo: Tipo
  valor: Prisma.Decimal
}

/** Rateio: para cada `itemId`, quanto vai para cada código de filho. */
export type Distribuicao = Record<string, Record<string, Prisma.Decimal>>

export type ItemNovo = { lancamentoId: string; codigo: string; tipo: Tipo; valor: Prisma.Decimal }
export type ResumoFilho = { codigo: string; ano: number; mes: number; debito: Prisma.Decimal; credito: Prisma.Decimal }

export type PlanoDistribuicao = {
  itensNovos: ItemNovo[]
  resumos: ResumoFilho[]
  saldosIniciais: { codigo: string; valor: Prisma.Decimal }[]
}

/**
 * Valida e PLANEJA o desdobramento com distribuição retroativa ao início do
 * exercício. Função PURA (sem banco) — toda a aritmética/validação fica testável.
 *
 * Regras:
 *  - ≥ 2 filhos; códigos únicos e não-vazios; descrição não-vazia.
 *  - Para cada movimento, as partes informadas somam EXATAMENTE o valor do
 *    movimento (rateio); partes negativas são inválidas.
 *  - A soma dos saldos iniciais digitados = saldo inicial da mãe.
 *  - Cada parte > 0 vira um item novo no filho (MESMO lançamento e tipo) → a
 *    partida dobrada de cada lançamento é preservada (só troca a conta).
 */
export function planejarDistribuicao(
  saldoInicialMae: Prisma.Decimal,
  filhos: FilhoNovo[],
  movimentos: MovimentoMae[],
  distribuicao: Distribuicao,
): PlanoDistribuicao {
  if (filhos.length < 2) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Informe ao menos 2 contas filhas.')

  const codigos = new Set<string>()
  for (const f of filhos) {
    const c = f.codigo.trim()
    if (!c) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Toda conta filha precisa de código.')
    if (!f.descricao.trim()) throw new ErroNegocio('REQUISICAO_INVALIDA', `Conta "${c}" sem descrição.`)
    if (codigos.has(c)) throw new ErroNegocio('CONFLITO', `Código de filho repetido: "${c}".`)
    codigos.add(c)
  }

  // Saldo inicial: soma dos digitados = saldo inicial da mãe.
  let somaInicial = ZERO
  const saldosIniciais = filhos.map((f) => {
    if (f.saldoInicial.isNegative()) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', `Saldo inicial negativo na conta "${f.codigo.trim()}".`)
    }
    somaInicial = somaInicial.plus(f.saldoInicial)
    return { codigo: f.codigo.trim(), valor: f.saldoInicial }
  })
  if (!somaInicial.equals(saldoInicialMae)) {
    throw new ErroNegocio(
      'REQUISICAO_INVALIDA',
      `Saldo inicial distribuído (${somaInicial}) difere do saldo inicial da conta (${saldoInicialMae}).`,
    )
  }

  // Movimentos: cada um precisa ter o rateio fechado (soma = valor).
  const itensNovos: ItemNovo[] = []
  const resumoMap = new Map<string, ResumoFilho>() // chave: codigo|ano|mes
  for (const m of movimentos) {
    const partes = distribuicao[m.itemId] ?? {}
    let soma = ZERO
    for (const [codigo, valor] of Object.entries(partes)) {
      if (!codigos.has(codigo)) throw new ErroNegocio('REQUISICAO_INVALIDA', `Movimento atribuído a filho inexistente "${codigo}".`)
      if (valor.isNegative()) throw new ErroNegocio('REQUISICAO_INVALIDA', 'Valor de rateio não pode ser negativo.')
      soma = soma.plus(valor)
      if (valor.isZero()) continue
      itensNovos.push({ lancamentoId: m.lancamentoId, codigo, tipo: m.tipo, valor })
      const chave = `${codigo}|${m.ano}|${m.mes}`
      const r = resumoMap.get(chave) ?? { codigo, ano: m.ano, mes: m.mes, debito: ZERO, credito: ZERO }
      if (m.tipo === 'DEBITO') r.debito = r.debito.plus(valor)
      else r.credito = r.credito.plus(valor)
      resumoMap.set(chave, r)
    }
    if (!soma.equals(m.valor)) {
      throw new ErroNegocio('REQUISICAO_INVALIDA', `Movimento de ${m.valor} não foi totalmente distribuído (soma informada = ${soma}).`)
    }
  }

  return { itensNovos, resumos: [...resumoMap.values()], saldosIniciais }
}

/**
 * Desdobra uma conta analítica em vários filhos, redistribuindo TODAS as
 * movimentações do exercício (e o saldo inicial) para os filhos conforme o
 * rateio do usuário — retroativo a 1º de janeiro. Reaponta os lançamentos,
 * recompõe o resumo mensal, zera a mãe (vira sintética). Tudo numa transação.
 */
export class DesdobramentoDistribuicaoService {
  constructor(private prisma: PrismaClient) {}

  async executar(contaId: string, filhos: FilhoNovo[], distribuicao: Distribuicao) {
    const mae = await this.prisma.contaContabilEntidade.findUnique({ where: { id: contaId } })
    if (!mae) throw new ErroNegocio('RECURSO_NAO_ENCONTRADO', 'Conta não encontrada.')
    if (!mae.admiteMovimento) {
      throw new ErroNegocio('CONFLITO', 'Só uma conta analítica pode ser desdobrada com distribuição.')
    }

    const si = await this.prisma.saldoInicialAno.findUnique({
      where: { entidadeId_contaId_ano: { entidadeId: mae.entidadeId, contaId: mae.id, ano: mae.ano } },
    })
    const saldoInicialMae = si?.valor ?? ZERO

    const itens = await this.prisma.lancamentoItem.findMany({
      where: { contaId: mae.id },
      select: { id: true, lancamentoId: true, tipo: true, valor: true, lancamento: { select: { data: true } } },
    })
    const movimentos: MovimentoMae[] = itens.map((it) => ({
      itemId: it.id,
      lancamentoId: it.lancamentoId,
      tipo: it.tipo as Tipo,
      valor: it.valor,
      ano: it.lancamento.data.getUTCFullYear(),
      mes: it.lancamento.data.getUTCMonth() + 1,
    }))

    const plano = planejarDistribuicao(saldoInicialMae, filhos, movimentos, distribuicao)

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Cria os filhos (analíticos) e mapeia código → id.
        const idPorCodigo = new Map<string, string>()
        for (const f of filhos) {
          const filho = await tx.contaContabilEntidade.create({
            data: {
              entidadeId: mae.entidadeId,
              ano: mae.ano,
              codigo: f.codigo.trim(),
              descricao: f.descricao.trim(),
              nivel: mae.nivel + 1,
              admiteMovimento: true,
              origem: 'DESDOBRAMENTO',
              parentId: mae.id,
            },
            select: { id: true },
          })
          idPorCodigo.set(f.codigo.trim(), filho.id)
        }

        // 2. Cria os itens novos (partes nos filhos) e apaga os originais da mãe.
        if (plano.itensNovos.length) {
          await tx.lancamentoItem.createMany({
            data: plano.itensNovos.map((i) => ({
              lancamentoId: i.lancamentoId,
              contaId: idPorCodigo.get(i.codigo)!,
              tipo: i.tipo,
              valor: i.valor,
            })),
          })
        }
        await tx.lancamentoItem.deleteMany({ where: { contaId: mae.id } })

        // 3. Saldo inicial: remove o da mãe, cria os dos filhos.
        await tx.saldoInicialAno.deleteMany({ where: { entidadeId: mae.entidadeId, contaId: mae.id, ano: mae.ano } })
        for (const s of plano.saldosIniciais) {
          if (s.valor.isZero()) continue
          await tx.saldoInicialAno.create({
            data: { entidadeId: mae.entidadeId, contaId: idPorCodigo.get(s.codigo)!, ano: mae.ano, valor: s.valor },
          })
        }

        // 4. Resumo mensal: remove o da mãe, recria pelos totais dos filhos.
        await tx.resumoMensalConta.deleteMany({ where: { entidadeId: mae.entidadeId, contaId: mae.id } })
        for (const r of plano.resumos) {
          await tx.resumoMensalConta.create({
            data: {
              entidadeId: mae.entidadeId,
              contaId: idPorCodigo.get(r.codigo)!,
              ano: r.ano,
              mes: r.mes,
              totalDebito: r.debito,
              totalCredito: r.credito,
            },
          })
        }

        // 5. A mãe vira sintética (não recebe mais lançamento direto).
        await tx.contaContabilEntidade.update({ where: { id: mae.id }, data: { admiteMovimento: false } })

        return { filhos: [...idPorCodigo.values()] }
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ErroNegocio('CONFLITO', 'Já existe conta com um dos códigos informados nesta entidade/exercício.')
      }
      throw e
    }
  }
}
