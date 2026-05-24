import { build } from "esbuild";

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

console.log("✓ API bundled to api/handler.mjs");
