import { defineConfig } from '@adonisjs/cors'
import env from '#start/env'

const corsConfig = defineConfig({
  enabled: true,
  origin: env.get('CORS_ALLOWED_ORIGINS')
    ? (env.get('CORS_ALLOWED_ORIGINS') as string).split(',')
    : true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  headers: true,
  exposeHeaders: [],
  credentials: false,
  maxAge: 90,
})

export default corsConfig
