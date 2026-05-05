// Blocos reutilizáveis
const str = { type: 'string' } as const
const strOpt = { type: 'string' } as const
const boolOpt = { type: 'boolean' } as const
const intOpt = { type: 'integer' } as const
const uuidOpt = { type: 'string', format: 'uuid' } as const

const tipoValidacao = { type: 'string', enum: ['EMAIL', 'CELULAR'] } as const
const tipoItem = { type: 'string', enum: ['FUNCIONALIDADE', 'SUBMENU'] } as const
const tipoFuncionalidade = { type: 'string', enum: ['CRUD', 'TELA', 'RELATORIO'] } as const
const nivelAcesso = { type: 'string', enum: ['VISUALIZAR', 'CRIAR', 'EDITAR', 'EXCLUIR', 'TOTAL'] } as const

// ── Auth ──────────────────────────────────────────────────────────────────────

export const sRegistro = {
  body: {
    type: 'object',
    required: ['nomeCompleto', 'nomeSocial', 'dataNascimento', 'emailPrincipal', 'telefonePrincipal', 'senha'],
    additionalProperties: false,
    properties: {
      cpf: str,
      idEstrangeiro: str,
      nomeCompleto: str,
      nomeSocial: str,
      dataNascimento: str,
      emailPrincipal: { type: 'string', format: 'email' },
      emailAlternativo: { type: 'string', format: 'email' },
      telefonePrincipal: str,
      telefoneAlternativo: str,
      senha: { type: 'string', minLength: 8 },
    },
  },
} as const

export const sLogin = {
  body: {
    type: 'object',
    required: ['email', 'senha'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email' },
      senha: str,
    },
  },
} as const

export const sSolicitarValidacao = {
  body: {
    type: 'object',
    required: ['tipo'],
    additionalProperties: false,
    properties: { tipo: tipoValidacao },
  },
} as const

export const sValidarCodigo = {
  body: {
    type: 'object',
    required: ['tipo', 'codigo'],
    additionalProperties: false,
    properties: {
      tipo: tipoValidacao,
      codigo: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
    },
  },
} as const

// ── Usuários ──────────────────────────────────────────────────────────────────

export const sAtualizarUsuario = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nomeCompleto: strOpt,
      nomeSocial: strOpt,
      dataNascimento: strOpt,
      emailAlternativo: { type: 'string', format: 'email' },
      telefoneAlternativo: strOpt,
    },
  },
} as const

// ── Sistemas ──────────────────────────────────────────────────────────────────

export const sCriarSistema = {
  body: {
    type: 'object',
    required: ['nome', 'adminUsuarioId'],
    additionalProperties: false,
    properties: {
      nome: str,
      descricao: strOpt,
      adminUsuarioId: uuidOpt,
    },
  },
} as const

export const sAtualizarSistema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nome: strOpt,
      descricao: strOpt,
      ativo: boolOpt,
    },
  },
} as const

// ── Módulos ───────────────────────────────────────────────────────────────────

export const sCriarModulo = {
  body: {
    type: 'object',
    required: ['nome', 'adminUsuarioId'],
    additionalProperties: false,
    properties: {
      nome: str,
      descricao: strOpt,
      adminUsuarioId: uuidOpt,
    },
  },
} as const

export const sAtualizarModulo = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nome: strOpt,
      descricao: strOpt,
      ativo: boolOpt,
    },
  },
} as const

// ── Menus ─────────────────────────────────────────────────────────────────────

export const sCriarMenu = {
  body: {
    type: 'object',
    required: ['nome'],
    additionalProperties: false,
    properties: {
      nome: str,
      icone: strOpt,
      ordem: intOpt,
    },
  },
} as const

export const sAtualizarMenu = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nome: strOpt,
      icone: strOpt,
      ordem: intOpt,
      ativo: boolOpt,
    },
  },
} as const

// ── Itens ─────────────────────────────────────────────────────────────────────

export const sCriarItem = {
  body: {
    type: 'object',
    required: ['nome', 'tipo'],
    additionalProperties: false,
    properties: {
      nome: str,
      descricao: strOpt,
      tipo: tipoItem,
      tipoFuncionalidade: tipoFuncionalidade,
      rota: strOpt,
      icone: strOpt,
      ordem: intOpt,
      parentId: uuidOpt,
    },
  },
} as const

export const sAtualizarItem = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nome: strOpt,
      descricao: strOpt,
      tipoFuncionalidade: tipoFuncionalidade,
      rota: strOpt,
      icone: strOpt,
      ordem: intOpt,
      ativo: boolOpt,
    },
  },
} as const

// ── Admins ────────────────────────────────────────────────────────────────────

export const sAdicionarAdmin = {
  body: {
    type: 'object',
    required: ['usuarioId'],
    additionalProperties: false,
    properties: { usuarioId: uuidOpt },
  },
} as const

// ── Permissões ────────────────────────────────────────────────────────────────

export const sConcederPermissao = {
  body: {
    type: 'object',
    required: ['itemId', 'nivel'],
    additionalProperties: false,
    properties: {
      itemId: uuidOpt,
      nivel: nivelAcesso,
    },
  },
} as const

export const sAtualizarPermissao = {
  body: {
    type: 'object',
    required: ['nivel'],
    additionalProperties: false,
    properties: { nivel: nivelAcesso },
  },
} as const

// ── Relatórios ────────────────────────────────────────────────────────────────

export const sCriarRelatorioFixo = {
  body: {
    type: 'object',
    required: ['nome', 'rota'],
    additionalProperties: false,
    properties: {
      nome: str,
      descricao: strOpt,
      rota: str,
    },
  },
} as const

export const sAtualizarRelatorioFixo = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nome: strOpt,
      descricao: strOpt,
      rota: strOpt,
      ativo: boolOpt,
    },
  },
} as const

export const sCriarRelatorioPersonalizado = {
  body: {
    type: 'object',
    required: ['nome', 'configuracao'],
    additionalProperties: false,
    properties: {
      nome: str,
      descricao: strOpt,
      configuracao: { type: 'object' },
    },
  },
} as const

export const sAtualizarRelatorioPersonalizado = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nome: strOpt,
      descricao: strOpt,
      configuracao: { type: 'object' },
      ativo: boolOpt,
    },
  },
} as const

// ── Favoritos ─────────────────────────────────────────────────────────────────

export const sCriarPasta = {
  body: {
    type: 'object',
    required: ['nome'],
    additionalProperties: false,
    properties: {
      nome: str,
      ordem: intOpt,
      parentId: uuidOpt,
    },
  },
} as const

export const sAtualizarPasta = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nome: strOpt,
      ordem: intOpt,
    },
  },
} as const

export const sAdicionarFavorito = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pastaId: uuidOpt,
      relatorioFixoId: uuidOpt,
      relatorioPersonalizadoId: uuidOpt,
      ordem: intOpt,
    },
  },
} as const

export const sMoverFavorito = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pastaId: { type: ['string', 'null'] },
      ordem: intOpt,
    },
  },
} as const
