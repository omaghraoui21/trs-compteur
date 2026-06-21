import type { Request } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users, electronicSignatures } from "@trs/db";
import type { DbOrTx } from "@trs/db";
import { HttpError } from "./http";

type Signer = typeof users.$inferSelect;

// 21 CFR Part 11: re-authenticate the signer at the moment of signing.
// Throws HttpError(401) on an unknown/inactive signer or a bad password.
export async function reauthSigner(db: DbOrTx, userId: string, password: string): Promise<Signer> {
  const [signer] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!signer || !signer.isActive) throw new HttpError(401, "Signataire invalide");
  const ok = await bcrypt.compare(password, signer.passwordHash);
  if (!ok) throw new HttpError(401, "Signature électronique invalide : mot de passe incorrect");
  return signer;
}

// Record an immutable electronic-signature manifestation for a signed action.
export async function recordSignature(
  db: DbOrTx,
  req: Request,
  signer: Signer,
  opts: { entityType: string; entityId: string; meaning: string; action: string; comment: string | null },
) {
  const [signature] = await db.insert(electronicSignatures).values({
    userId: signer.id,
    userEmail: signer.email,
    userName: signer.displayName,
    entityType: opts.entityType,
    entityId: opts.entityId,
    meaning: opts.meaning,
    action: opts.action,
    comment: opts.comment,
    ipAddress: req.ip ?? null,
  }).returning();
  return signature;
}
