import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "@trs/db";
import { signToken, authenticate } from "../middleware";
import { asyncHandler, validate } from "../lib/http";
import { loginSchema } from "../schemas";

export const authRouter = Router();

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
  const token = signToken(user.id, user.role);
  res.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
  });
}));

authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  const { db, userId } = req;
  if (!userId) { res.status(401).json({ error: "Non authentifié" }); return; }
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }
  res.json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role });
}));
