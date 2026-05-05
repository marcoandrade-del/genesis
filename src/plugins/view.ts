import fp from 'fastify-plugin'
import view from '@fastify/view'
import ejs from 'ejs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default fp(async (app) => {
  app.register(view, {
    engine: { ejs },
    root: path.join(__dirname, '..', 'views'),
    viewExt: 'ejs',
  })
})
