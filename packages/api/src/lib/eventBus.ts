import { EventEmitter } from "node:events";

export type LiveEventType =
  | "session.opened" | "session.closed" | "session.updated"
  | "lot.started" | "lot.updated" | "lot.closed" | "lot.validated"
  | "downtime.added" | "downtime.deleted" | "alert.triggered" | "alert.acknowledged";

export interface LiveEvent {
  type: LiveEventType;
  entityId?: string;
  equipmentId?: string;
  sessionId?: string;
  occurredAt: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(250);

export function publishLiveEvent(event: Omit<LiveEvent, "occurredAt">) {
  bus.emit("event", { ...event, occurredAt: new Date().toISOString() } satisfies LiveEvent);
}

export function subscribeLiveEvents(listener: (event: LiveEvent) => void) {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}
