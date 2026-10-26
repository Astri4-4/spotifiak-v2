import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  DEEMIX_URL: z.string().url(),
  DEEMIX_ARL: z.string().optional(),
  MUSIC_DIR: z.string().min(1),
  // Quick scans (new/removed files); 0 disables periodic rescans
  SCAN_INTERVAL_SEC: z.coerce.number().int().min(0).default(300),
  // Full scans also catch files modified in place; 0 disables
  FULL_SCAN_INTERVAL_HOURS: z.coerce.number().min(0).default(24),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Anyone can create an account when true; otherwise only the first account
  // (which becomes admin) can sign up and admins create the others.
  ALLOW_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Set to true when Spotifiak is served over HTTPS so the session cookie is HTTPS-only.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Album covers and artist pictures come from Deezer's public API.
  DEEZER_API_URL: z.string().url().default('https://api.deezer.com'),
  DEEZER_ENRICH: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})

export const config = schema.parse(process.env)
