// Narrow a caught `unknown` to a human-readable message. The API client
// (lib/api.ts) throws real `Error` instances, so this returns their `.message`;
// anything else is stringified as a fallback.
export function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
