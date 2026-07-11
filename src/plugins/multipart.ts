import fp from 'fastify-plugin'
import multipart from '@fastify/multipart'

/**
 * Upload de arquivos (multipart/form-data). Usado pela tela do conversor para
 * receber os exports do portal do fabricante (CSV/XLSX). Consumimos via
 * `req.parts()` (stream para disco), então não anexamos os campos ao body.
 */
export default fp(async (app) => {
  app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 }, // 50 MB por arquivo, 1 por requisição
  })
})
