// Validação compartilhada do brasão (data URL base64) recebido dos formulários
// admin. O cliente já limita a 1 MB; estes são a rede de segurança do servidor.
// BODY_BRASAO (corpo total) folga acima do MAX_BRASAO para o 413 nunca disparar
// antes da validação amigável.
const MAX_BRASAO = 1.5 * 1024 * 1024
export const BODY_BRASAO = 2 * 1024 * 1024
const RE_BRASAO = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/

/**
 * Valida o brasão recebido do formulário. `''` significa "sem brasão / remover"
 * (→ null); um data URL de imagem raster é aceito; qualquer outra coisa é erro.
 */
export function validarBrasao(v: string): { ok: true; valor: string | null } | { ok: false; erro: string } {
  const s = v.trim()
  if (s === '') return { ok: true, valor: null }
  if (s.length > MAX_BRASAO) return { ok: false, erro: 'Imagem muito grande (máx. 1 MB). Use um arquivo menor.' }
  if (!RE_BRASAO.test(s)) return { ok: false, erro: 'Brasão inválido — envie uma imagem PNG, JPG, GIF ou WEBP.' }
  return { ok: true, valor: s }
}
