import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` runs without a database (e.g. in the Docker build).
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://localhost/unused' },
})
