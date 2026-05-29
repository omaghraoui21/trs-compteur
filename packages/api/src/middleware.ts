import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Db } from "@trs/db";

// C1: Refuse to start with a public default secret in production
const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: JWT_SECRET environment variable must be set in production");
      process.exit(1);
    }
    console.warn("WARNING: JWT_SECRET not set — using insecure dev default");
    return "trs-compteur-dev-secret";
  }
  return s;
})();

// Extend Express Request globally
declare global {
  namespace Express {
    interface Request {
      db: Db;
      userId?: string;
      userRole?: string;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token manquant" });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string; role: string };
    req.userId = payload.sub;
    req.userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ error: "Token invalide" });
  }
}

// M2: short-lived access token — longevity is provided by the refresh-token flow
export function signToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: "15m" });
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = req.userRole;
    if (!r || !roles.includes(r)) {
      res.status(403).json({ error: "Accès interdit" });
      return;
    }
    next();
  };
}
