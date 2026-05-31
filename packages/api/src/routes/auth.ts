import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { eq, and, isNull } from "drizzle-orm";
import { users, refreshTokens } from "@trs/db";
import { signToken, authenticate } from "../middleware";
import { asyncHandler, validate } from "../lib/http";
import { audit } from "../lib/audit";
import { loginSchema, refreshSchema, changePasswordSchema } from "../schemas";

export const authRouter = Router();

const REFRESH_TTL_DAYS = 30;
// Grace window for benign concurrent refresh (e.g. multiple browser tabs sharing
// localStorage replaying a just-rotated token). Within this window we re-issue
// instead of treating it as a stolen-token reuse and revoking the whole family.
const REUSE_GRACE_MS = 10_000;

function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);
}

const publicUser = (u: { id: string; email: string; displayName: string; role: string }) =>
  ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role });

authRouter.post("/login", validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { db } = req;
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Identifiants invalides" });
    return;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Identifiants invalides" });
    return;
  }

  // Start a fresh refresh-token family for this login
  const refreshToken = generateRefreshToken();
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    familyId: crypto.randomUUID(),
    expiresAt: refreshExpiry(),
  });

  const token = signToken(user.id, user.role, user.email);
  res.json({ token, refreshToken, user: publicUser(user) });
}));

// M2: rotate the refresh token. Reuse of a revoked token revokes the whole family.
authRouter.post("/refresh", validate(refreshSchema), asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const { db } = req;
  const hash = hashToken(refreshToken);

  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1);
  if (!row) {
    res.status(401).json({ error: "Refresh token invalide" });
    return;
  }

  // Reuse detection: a revoked token is being replayed. Outside the grace window
  // this means a stolen/leaked token → revoke the entire family. Inside the window
  // it's a benign concurrent refresh, so we fall through and issue a fresh token.
  if (row.revokedAt && Date.now() - row.revokedAt.getTime() > REUSE_GRACE_MS) {
    await db.update(refreshTokens).set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    res.status(401).json({ error: "Réutilisation détectée — session révoquée" });
    return;
  }

  if (row.expiresAt.getTime() < Date.now()) {
    res.status(401).json({ error: "Refresh token expiré" });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Utilisateur inactif" });
    return;
  }

  // Rotation: revoke the presented token and mint a new one in the same family
  const now = new Date();
  await db.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, row.id));

  const newRefresh = generateRefreshToken();
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashToken(newRefresh),
    familyId: row.familyId,
    expiresAt: refreshExpiry(),
  });

  const token = signToken(user.id, user.role, user.email);
  res.json({ token, refreshToken: newRefresh, user: publicUser(user) });
}));

// M2: revoke the whole family the presented token belongs to (logout on this device chain)
authRouter.post("/logout", validate(refreshSchema), asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const { db } = req;
  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(refreshToken))).limit(1);
  if (row) {
    await db.update(refreshTokens).set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
  }
  res.json({ ok: true });
}));

authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  const { db, userId } = req;
  if (!userId) { res.status(401).json({ error: "Non authentifié" }); return; }
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }
  res.json(publicUser(user));
}));

// Self-service password change — verifies the current password, then rotates.
authRouter.post("/change-password", authenticate, validate(changePasswordSchema), asyncHandler(async (req, res) => {
  const { db, userId } = req;
  const { oldPassword, newPassword } = req.body;
  if (!userId) { res.status(401).json({ error: "Non authentifié" }); return; }
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }
  const valid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Mot de passe actuel incorrect" }); return; }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  await audit(db, req, "CHANGE_PASSWORD", "user", userId, {});
  res.json({ ok: true });
}));
