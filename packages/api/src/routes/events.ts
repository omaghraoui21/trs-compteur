import { Router } from "express";
import { authenticate } from "../middleware";
import { subscribeLiveEvents } from "../lib/eventBus";

export const eventsRouter = Router();

// EventSource cannot set Authorization headers. The web client passes its
// short-lived access token in the query string; normalize it before auth.
eventsRouter.get("/stream", (req, _res, next) => {
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  if (token && !req.headers.authorization) req.headers.authorization = `Bearer ${token}`;
  next();
}, authenticate, (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);

  const unsubscribe = subscribeLiveEvents((event) => {
    res.write(`event: update\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 30_000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});
