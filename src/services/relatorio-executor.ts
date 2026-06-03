import { Pool } from 'pg'
import { ErroNegocio } from '../errors.js'

// Limites do sandbox.
const MAX_LINHAS = 500
const TIMEOUT_MS = 5000

export type ContextoExecucao = { entidadeId: string; ano: number }
export type ResultadoExecucao = {
  colunas: string[]
  linhas: unknown[][]
  total: number
  truncado: boolean
}

/**
 * Valida que a query é uma única instrução de leitura. NÃO é a barreira de
 * segurança principal — quem garante somente-leitura é a transação READ ONLY +
 * a role do banco com SELECT apenas nas views `rel_*`. Aqui só damos um erro
 * claro cedo e bloqueamos múltiplas instruções.
 */
export function validarQuery(sql: string): string {
  const q = (sql ?? '').trim().replace(/\s*;\s*$/, '')
  if (!q) throw new ErroNegocio('REQUISICAO_INVALIDA', 'A query está vazia.')
  if (q.includes(';')) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', 'Apenas uma instrução SELECT é permitida (remova o ";").')
  }
  if (!/^(select|with)\b/i.test(q)) {
    throw new ErroNegocio('REQUISICAO_INVALIDA', 'A query deve começar com SELECT (ou WITH).')
  }
  return q
}

/**
 * Substitui os placeholders nomeados `:entidadeId` e `:ano` por parâmetros
 * posicionais ($1, $2…) ligados aos valores do contexto, na ordem de inclusão.
 * Só inclui o parâmetro se ele aparecer na query (pg rejeita parâmetro a mais).
 */
export function prepararQuery(sql: string, ctx: ContextoExecucao): { text: string; values: unknown[] } {
  const values: unknown[] = []
  let text = sql
  if (/:entidadeId\b/.test(text)) {
    values.push(ctx.entidadeId)
    text = text.replace(/:entidadeId\b/g, `$${values.length}`)
  }
  if (/:ano\b/.test(text)) {
    values.push(ctx.ano)
    text = text.replace(/:ano\b/g, `$${values.length}`)
  }
  return { text, values }
}

/**
 * Executa a query do relatório no sandbox: conexão read-only dedicada,
 * transação READ ONLY, `statement_timeout`, e `app.entidade` setado por
 * transação (as views `rel_*` filtram por ele → isolamento por entidade).
 * Recebe o Pool por injeção (null = sandbox não configurado).
 */
export class RelatorioExecutor {
  constructor(private pool: Pool | null) {}

  get configurado(): boolean {
    return this.pool !== null
  }

  async executar(query: string, ctx: ContextoExecucao): Promise<ResultadoExecucao> {
    if (!this.pool) {
      throw new ErroNegocio('CONFLITO', 'O sandbox de relatórios não está configurado (defina REPORT_DB_URL).')
    }
    const sql = validarQuery(query)
    const { text, values } = prepararQuery(sql, ctx)

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`)
      // GUC por transação que as views leem para filtrar a entidade.
      await client.query('SELECT set_config($1, $2, true)', ['app.entidade', ctx.entidadeId])
      const res = await client.query({ text, values, rowMode: 'array' })
      const colunas = (res.fields ?? []).map((f: { name: string }) => f.name)
      const todas = (res.rows ?? []) as unknown[][]
      return {
        colunas,
        linhas: todas.slice(0, MAX_LINHAS),
        total: todas.length,
        truncado: todas.length > MAX_LINHAS,
      }
    } catch (e) {
      throw traduzErroPg(e)
    } finally {
      try {
        await client.query('ROLLBACK')
      } catch {
        // conexão pode já estar inválida; ignorar
      }
      client.release()
    }
  }
}

// Converte erros do Postgres em mensagens de negócio claras para o operador.
function traduzErroPg(e: unknown): ErroNegocio {
  if (e instanceof ErroNegocio) return e
  const err = e as { code?: string; message?: string }
  if (err.code === '57014') {
    return new ErroNegocio('REQUISICAO_INVALIDA', `A consulta excedeu o tempo limite (${TIMEOUT_MS / 1000}s).`)
  }
  if (err.code === '25006') {
    return new ErroNegocio('REQUISICAO_INVALIDA', 'A query tentou modificar dados — apenas leitura é permitida.')
  }
  return new ErroNegocio('REQUISICAO_INVALIDA', `Erro ao executar a consulta: ${err.message ?? 'desconhecido'}`)
}

/**
 * Pool read-only do relatório, criado a partir de `REPORT_DB_URL`. Sem a env,
 * devolve um executor "não configurado" (execução desabilitada com erro claro)
 * em vez de cair na conexão principal sem isolamento. Singleton por processo.
 */
let poolPadrao: Pool | null | undefined
export function criarExecutorPadrao(): RelatorioExecutor {
  if (poolPadrao === undefined) {
    const url = process.env['REPORT_DB_URL']
    poolPadrao = url ? new Pool({ connectionString: url, max: 4 }) : null
  }
  return new RelatorioExecutor(poolPadrao)
}
