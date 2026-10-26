import { z } from 'zod'

// compose passes unset optional variables as empty strings.
const unsetIfEmpty = <T extends z.ZodTypeAny>(type: T) => z.preprocess((v) => (v === '' ? undefined : v), type)

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
  // Spotify playlist import (optional). Credentials of an app created on
  // developer.spotify.com; its redirect URI must be exactly SPOTIFY_REDIRECT_URI.
  SPOTIFY_CLIENT_ID: unsetIfEmpty(z.string().optional()),
  SPOTIFY_CLIENT_SECRET: unsetIfEmpty(z.string().optional()),
  SPOTIFY_REDIRECT_URI: unsetIfEmpty(z.string().url().optional()),
  // Overridable for tests against a mock server.
  SPOTIFY_ACCOUNTS_URL: z.string().url().default('https://accounts.spotify.com'),
  SPOTIFY_API_URL: z.string().url().default('https://api.spotify.com/v1'),
  // Album covers and artist pictures come from Deezer's public API.
  DEEZER_API_URL: z.string().url().default('https://api.deezer.com'),
  DEEZER_ENRICH: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})

export const config = schema.parse(process.env)
