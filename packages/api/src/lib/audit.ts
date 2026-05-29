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
  } catch {
    // Audit failures must not break the primary operation
    console.error("audit write failed", { action, entityType, entityId });
  }
}
