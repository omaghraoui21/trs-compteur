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
