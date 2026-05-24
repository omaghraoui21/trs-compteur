import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Db } from "@trs/db";

const JWT_SECRET = process.env.JWT_SECRET || "trs-compteur-dev-secret";

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

export function signToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: "12h" });
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
