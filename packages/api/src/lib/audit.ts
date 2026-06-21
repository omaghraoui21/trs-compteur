import type { Request } from "express";
import * as Sentry from "@sentry/node";
import { auditLog } from "@trs/db";
import type { DbOrTx } from "@trs/db";

export async function audit(
  db: DbOrTx,
  req: Request,
  action: string,
  entityType: string,
  entityId: string | undefined,
  payload?: object,
) {
  try {
    await db.insert(auditLog).values({
      actorId: req.userId ?? null,
      actorEmail: req.userEmail ?? "unknown",
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
      actor: req.userEmail,
      error: err instanceof Error ? err.message : String(err),
    });
    // Surface to external monitoring so a missing audit trail can't go
    // unnoticed (no-op when Sentry is not configured).
    Sentry.captureException(err, {
      tags: { kind: "audit_write_failure", action, entityType },
      extra: { entityId, actor: req.userEmail },
    });
  }
}
