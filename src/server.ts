import { app } from './app.js'

const PORT = Number(process.env.PORT ?? 3000)

if (process.env['NODE_ENV'] === 'production' && !process.env['BASE_URL']) {
  app.log.error('BASE_URL é obrigatória em produção (usada nos links de ativação enviados por e-mail).')
  process.exit(1)
}

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
})
