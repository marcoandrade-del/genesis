export class ErroNegocio extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ErroNegocio'
  }
}

export function erroHttp(code: string, message: string) {
  return { error: { code, message } }
}

export function statusDeErro(code: string): number {
  switch (code) {
    case 'RECURSO_NAO_ENCONTRADO': return 404
    case 'CONFLITO': return 409
    case 'REQUISICAO_INVALIDA': return 400
    case 'ENTIDADE_NAO_PROCESSAVEL': return 422
    case 'NAO_AUTORIZADO': return 403
    default: return 500
  }
}

export function tratarErro(e: unknown, reply: any): unknown {
  if (e instanceof ErroNegocio) {
    return reply.status(statusDeErro(e.code)).send(erroHttp(e.code, e.message))
  }
  throw e
}
