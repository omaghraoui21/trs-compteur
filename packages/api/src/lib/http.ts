import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ZodSchema } from "zod";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

// Ownership guard shared across routes: operators may act only on records they
// own; supervisors and admins are unrestricted. A null `ownerId` (no recorded
// owner) bypasses the check. Throws HttpError(403) otherwise. Call sites that
// pass a fallback owner (e.g. `createdBy ?? operatorId`) document why there.
export function assertOperatorOwns(
  userRole: string | undefined,
  userId: string | undefined,
  ownerId: string | null | undefined,
  message = "Accès interdit",
): void {
  if (userRole === "operator" && ownerId != null && ownerId !== userId) {
    throw new HttpError(403, message);
  }
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

// Wraps an async route handler so rejected promises reach the error middleware
// instead of leaving the request hanging (Express 4 does not await handlers).
export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function makeValidator(field: "body" | "query"): (schema: ZodSchema) => RequestHandler {
  return (schema) => (req, res, next) => {
    const result = schema.safeParse(req[field]);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join(".") || field}: ${i.message}`)
        .join("; ");
      res.status(400).json({ error: message });
      return;
    }
    (req as any)[field] = result.data;
    next();
  };
}

export const validate = makeValidator("body");
export const validateQuery = makeValidator("query");
