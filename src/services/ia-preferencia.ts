import { PrismaClient } from '@prisma/client'

/** Os dois motores de IA, no padrão do Oxy: rápida (local, custo zero) × profunda (IA paga). */
export type IaEngine = 'rapida' | 'profunda'

export interface MotorIa {
  id: string
  rotulo: string
  especialista: boolean
}

/** Motores da Pesquisa Profunda à escolha do usuário (espelha os provedores do Oxy). */
export const IA_MOTORES: readonly MotorIa[] = [
  { id: 'gemini', rotulo: 'Google · Gemini 2.5 Pro', especialista: false },
  { id: 'claude', rotulo: 'Anthropic · Claude Opus 4.8', especialista: false },
  { id: 'gpt', rotulo: 'OpenAI · GPT-4o', especialista: false },
  { id: 'sabia', rotulo: 'Especialista Fiscal · Sabiá-3', especialista: true },
]
export const IA_MOTOR_PADRAO = 'gemini'

export interface PreferenciaIa {
  engine: IaEngine
  motor: string
}

const normalizarEngine = (v: unknown): IaEngine => (v === 'profunda' ? 'profunda' : 'rapida')
const normalizarMotor = (v: unknown): string =>
  IA_MOTORES.some((m) => m.id === v) ? (v as string) : IA_MOTOR_PADRAO

/**
 * Preferência de IA por usuário: qual engine (rápida/profunda) e, na profunda,
 * qual motor. Memorizada no `Usuario`; o seletor da tela salva em tempo real.
 */
export class IaPreferenciaService {
  constructor(private prisma: PrismaClient) {}

  async ler(usuarioId: string): Promise<PreferenciaIa> {
    const u = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { iaEngine: true, iaMotor: true },
    })
    return { engine: normalizarEngine(u?.iaEngine), motor: normalizarMotor(u?.iaMotor) }
  }

  async salvar(usuarioId: string, pref: { engine?: unknown; motor?: unknown }): Promise<PreferenciaIa> {
    const engine = normalizarEngine(pref.engine)
    const motor = normalizarMotor(pref.motor)
    await this.prisma.usuario.update({ where: { id: usuarioId }, data: { iaEngine: engine, iaMotor: motor } })
    return { engine, motor }
  }
}
