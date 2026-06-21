import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";

// H4: Guard against missing DATABASE_URL — crash with a clear message instead of a null-deref later
const connectionString: string =
  process.env.DATABASE_URL ??
  (() => {
    console.error("FATAL: DATABASE_URL environment variable is not set");
    process.exit(1);
  })();

export function createDb(url = connectionString) {
  // Serverless-safe connection config. On Vercel each invocation is a separate
  // process, and the operator UI fires several requests at once (Promise.all on
  // equipment select). With the postgres default pool (max: 10) a burst of
  // concurrent cold-start instances opens too many connections to Neon at once
  // and the requests time out → "Connexion serveur impossible" in the UI.
  //   - max: 1 on Vercel keeps each instance to a single connection (requests
  //     queue on it instead of opening a connection storm).
  //   - idle_timeout closes idle connections so Neon's limit isn't exhausted.
  //   - connect_timeout gives a suspended Neon compute time to wake.
  //   - prepare: false is required when DATABASE_URL points at a pooled
  //     (PgBouncer / Neon pooler, transaction mode) endpoint.
  const isServerless = !!process.env.VERCEL;
  const client = postgres(url, {
    max: isServerless ? 1 : 10,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    // GxP: enforce TLS in all environments; Railway and Vercel both serve
    // postgres over SSL. In local dev with a non-SSL postgres (e.g. Docker
    // without certs), set DB_SSL=false in .env to skip.
    ssl: process.env.DB_SSL === "false" ? false : "require",
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
