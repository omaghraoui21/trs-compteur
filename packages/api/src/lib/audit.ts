import type { Request } from "express";
import { auditLog } from "@trs/db";
import type { Db } from "@trs/db";

export async function audit(
  db: Db,
  req: Request,
  action: string,
  entityType: string,
  entityId: string | undefined,
  payload?: object,
) {
  const actor = req as any;
  try {
    await db.insert(auditLog).values({
      actorId: actor.userId ?? null,
      actorEmail: actor.userEmail ?? "unknown",
      action,
      entityType,
      entityId: entityId ?? null,
      payload: payload ? JSON.stringify(payload) : null,
      ipAddress: req.ip ?? null,
    });
  } catch (err) {
    // Audit failures must not abort the primary operation, but they must
    // never be silent — a missing audit trail breaks pharma traceability.
    console.error("[AUDIT FAILURE] write failed — investigate immediately", {
      action,
      entityType,
      entityId,
      actor: (req as any).userEmail,
      error: err instanceof Error ? err.message : String(err),
    });
    // In production, alert via external monitoring (e.g. Sentry) rather than
    // swallowing. Wire an error-reporting integration here if available.
  }
}
