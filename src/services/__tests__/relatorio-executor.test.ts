import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validarQuery, prepararQuery, RelatorioExecutor } from '../relatorio-executor.js'
import { ErroNegocio } from '../../errors.js'

const CTX = { entidadeId: 'ent1', ano: 2026 }

describe('validarQuery', () => {
  it('aceita SELECT e WITH, removendo ; final', () => {
    expect(validarQuery('  SELECT 1 ;  ')).toBe('SELECT 1')
    expect(validarQuery('with x as (select 1) select * from x')).toMatch(/^with/i)
  })
  it('rejeita vazia (inclui null/undefined)', () => {
    expect(() => validarQuery('   ')).toThrow(ErroNegocio)
    expect(() => validarQuery(undefined as never)).toThrow(ErroNegocio)
  })
  it('rejeita múltiplas instruções', () => {
    expect(() => validarQuery('SELECT 1; DROP TABLE x')).toThrow(/uma instrução/i)
  })
  it('rejeita o que não começa com SELECT/WITH', () => {
    expect(() => validarQuery('UPDATE x SET a=1')).toThrow(/SELECT/i)
    expect(() => validarQuery('delete from x')).toThrow(ErroNegocio)
  })
})

describe('prepararQuery', () => {
  it('substitui :entidadeId e :ano por posicionais na ordem', () => {
    const r = prepararQuery('SELECT * FROM v WHERE e = :entidadeId AND ano = :ano', CTX)
    expect(r.text).toBe('SELECT * FROM v WHERE e = $1 AND ano = $2')
    expect(r.values).toEqual(['ent1', 2026])
  })
  it('inclui só o placeholder presente', () => {
    expect(prepararQuery('SELECT :ano', CTX)).toEqual({ text: 'SELECT $1', values: [2026] })
    expect(prepararQuery('SELECT 1', CTX)).toEqual({ text: 'SELECT 1', values: [] })
  })
  it('respeita limite de palavra (não casa :entidadeIdX)', () => {
    expect(prepararQuery('SELECT :entidadeIdX', CTX).values).toEqual([])
  })
})

function fakePool(queryImpl: (arg: unknown) => Promise<unknown>) {
  const client = { query: vi.fn(queryImpl), release: vi.fn() }
  const pool = { connect: vi.fn().mockResolvedValue(client) }
  return { pool, client }
}

// resolve strings (BEGIN/SET/ROLLBACK) e devolve linhas na query principal (objeto).
const okImpl = (rows: unknown[][], fields = [{ name: 'a' }, { name: 'b' }]) => (arg: unknown) =>
  typeof arg === 'string' ? Promise.resolve({}) : Promise.resolve({ fields, rows })

describe('RelatorioExecutor.executar', () => {
  it('lança quando não configurado (pool null)', async () => {
    const ex = new RelatorioExecutor(null)
    expect(ex.configurado).toBe(false)
    await expect(ex.executar('select 1', CTX)).rejects.toMatchObject({ code: 'CONFLITO' })
  })

  it('executa em transação read-only, seta app.entidade e devolve colunas/linhas', async () => {
    const { pool, client } = fakePool(okImpl([[1, 2], [3, 4]]))
    const ex = new RelatorioExecutor(pool as never)
    const res = await ex.executar('SELECT a, b FROM rel_lancamentos WHERE e = :entidadeId', CTX)
    expect(res).toEqual({ colunas: ['a', 'b'], linhas: [[1, 2], [3, 4]], total: 2, truncado: false })
    const sqls = client.query.mock.calls.map((c) => c[0])
    expect(sqls).toContain('BEGIN READ ONLY')
    expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', ['app.entidade', 'ent1'])
    // a query principal recebe o $1 do placeholder
    const principal = client.query.mock.calls.find((c) => typeof c[0] === 'object')![0] as { text: string; values: unknown[] }
    expect(principal.text).toContain('$1')
    expect(principal.values).toEqual(['ent1'])
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })

  it('trunca em 500 linhas', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => [i])
    const { pool } = fakePool(okImpl(rows, [{ name: 'n' }]))
    const ex = new RelatorioExecutor(pool as never)
    const res = await ex.executar('select n from rel_lancamentos', CTX)
    expect(res.total).toBe(501)
    expect(res.linhas.length).toBe(500)
    expect(res.truncado).toBe(true)
  })

  it('traduz timeout (57014)', async () => {
    const { pool, client } = fakePool((arg) =>
      typeof arg === 'string' ? Promise.resolve({}) : Promise.reject(Object.assign(new Error('x'), { code: '57014' })),
    )
    const ex = new RelatorioExecutor(pool as never)
    await expect(ex.executar('select 1', CTX)).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(client.release).toHaveBeenCalled()
  })

  it('traduz erro de escrita em transação read-only (25006)', async () => {
    const { pool } = fakePool((arg) =>
      typeof arg === 'string' ? Promise.resolve({}) : Promise.reject(Object.assign(new Error('ro'), { code: '25006' })),
    )
    const ex = new RelatorioExecutor(pool as never)
    await expect(ex.executar('select 1', CTX)).rejects.toThrow(/apenas leitura/i)
  })

  it('traduz erro genérico do Postgres mantendo a mensagem', async () => {
    const { pool } = fakePool((arg) =>
      typeof arg === 'string' ? Promise.resolve({}) : Promise.reject(Object.assign(new Error('relation "x" does not exist'), { code: '42P01' })),
    )
    const ex = new RelatorioExecutor(pool as never)
    await expect(ex.executar('select 1', CTX)).rejects.toThrow(/relation "x" does not exist/)
  })

  it('valida antes de conectar (query inválida não abre conexão)', async () => {
    const { pool } = fakePool(okImpl([]))
    const ex = new RelatorioExecutor(pool as never)
    await expect(ex.executar('UPDATE x SET a=1', CTX)).rejects.toMatchObject({ code: 'REQUISICAO_INVALIDA' })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('ignora falha no ROLLBACK ao tratar erro', async () => {
    const { pool, client } = fakePool((arg) => {
      if (typeof arg === 'object') return Promise.reject(Object.assign(new Error('q'), { code: '42P01' }))
      if (arg === 'ROLLBACK') return Promise.reject(new Error('conn morta'))
      return Promise.resolve({})
    })
    const ex = new RelatorioExecutor(pool as never)
    await expect(ex.executar('select 1', CTX)).rejects.toThrow(ErroNegocio)
    expect(client.release).toHaveBeenCalled()
  })

  it('tolera resultado sem fields/rows', async () => {
    const { pool } = fakePool((arg) => Promise.resolve(typeof arg === 'string' ? {} : {}))
    const ex = new RelatorioExecutor(pool as never)
    const res = await ex.executar('select 1', CTX)
    expect(res).toEqual({ colunas: [], linhas: [], total: 0, truncado: false })
  })

  it('repassa um ErroNegocio vindo do client sem reembrulhar', async () => {
    const original = new ErroNegocio('CONFLITO', 'erro de negócio')
    const { pool } = fakePool((arg) => (typeof arg === 'string' ? Promise.resolve({}) : Promise.reject(original)))
    const ex = new RelatorioExecutor(pool as never)
    await expect(ex.executar('select 1', CTX)).rejects.toBe(original)
  })

  it('erro do Postgres sem message vira "desconhecido"', async () => {
    const { pool } = fakePool((arg) => (typeof arg === 'string' ? Promise.resolve({}) : Promise.reject({ code: 'XX999' })))
    const ex = new RelatorioExecutor(pool as never)
    await expect(ex.executar('select 1', CTX)).rejects.toThrow(/desconhecido/)
  })
})

describe('criarExecutorPadrao', () => {
  const ORIG = process.env['REPORT_DB_URL']
  afterEach(() => {
    if (ORIG === undefined) delete process.env['REPORT_DB_URL']
    else process.env['REPORT_DB_URL'] = ORIG
    vi.resetModules()
  })

  it('sem REPORT_DB_URL → executor não configurado', async () => {
    vi.resetModules()
    delete process.env['REPORT_DB_URL']
    const mod = await import('../relatorio-executor.js')
    expect(mod.criarExecutorPadrao().configurado).toBe(false)
  })

  it('com REPORT_DB_URL → executor configurado', async () => {
    vi.resetModules()
    process.env['REPORT_DB_URL'] = 'postgresql://u:p@localhost:5432/db'
    const mod = await import('../relatorio-executor.js')
    expect(mod.criarExecutorPadrao().configurado).toBe(true)
  })
})
