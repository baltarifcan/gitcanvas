import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle config — used by `pnpm db:generate` to produce SQL migrations from
 * `src/main/db/schema.ts`. The migrations are read at runtime by
 * `src/main/db/client.ts` and applied on app startup.
 *
 * No `dbCredentials` block: we don't run `db:push` or `db:migrate` against a
 * live URL — migrations are bundled and run by the app itself.
 */
export default defineConfig({
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations',
  dialect: 'sqlite',
  verbose: true,
  strict: true,
})
