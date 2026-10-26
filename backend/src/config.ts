import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  DEEMIX_URL: z.string().url(),
  DEEMIX_ARL: z.string().optional(),
  MUSIC_DIR: z.string().min(1),
  // 0 disables periodic rescans
  SCAN_INTERVAL_SEC: z.coerce.number().int().min(0).default(300),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Album covers and artist pictures come from Deezer's public API.
  DEEZER_API_URL: z.string().url().default('https://api.deezer.com'),
  DEEZER_ENRICH: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})

export const config = schema.parse(process.env)
