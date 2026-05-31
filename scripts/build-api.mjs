import { build } from "esbuild";
import { cpSync, mkdirSync } from "fs";

// Bundle the main API handler
await build({
  entryPoints: ["packages/api/src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "api/handler.mjs",
  external: [
    "pg-native",
  ],
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});


// Copy migration SQL files so they are available to the Vercel serverless
// function bundle (server.ts resolves MIGRATIONS_DIR to ../../db/drizzle
// relative to api/handler.mjs → /var/task/db/drizzle on Vercel).
try {
  mkdirSync("db/drizzle/meta", { recursive: true });
  cpSync("packages/db/drizzle", "db/drizzle", { recursive: true });
} catch (err) {
  console.error("FATAL: failed to copy migration files into the bundle:", err);
  process.exit(1);
}

console.log("✓ API bundled to api/handler.mjs");
console.log("✓ Migration files copied to db/drizzle/");
