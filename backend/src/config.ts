import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  DEEMIX_URL: z.string().url(),
  DEEMIX_ARL: z.string().optional(),
  MUSIC_DIR: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
})

export const config = schema.parse(process.env)
