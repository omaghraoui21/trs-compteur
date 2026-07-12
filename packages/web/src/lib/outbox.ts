import { openDB } from "idb";

export interface OutboxItem {
  clientId: string;
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  capturedAt: string;
  attempts: number;
}

const dbPromise = openDB("trs-offline", 1, {
  upgrade(db) { db.createObjectStore("outbox", { keyPath: "clientId" }); },
});

export async function enqueueMutation(item: Omit<OutboxItem, "clientId" | "capturedAt" | "attempts">) {
  const queued: OutboxItem = { ...item, clientId: crypto.randomUUID(), capturedAt: new Date().toISOString(), attempts: 0 };
  await (await dbPromise).put("outbox", queued);
  window.dispatchEvent(new CustomEvent("trs-outbox-change"));
  return queued;
}
export async function listOutbox() { return (await dbPromise).getAll("outbox") as Promise<OutboxItem[]>; }
export async function removeOutbox(clientId: string) { await (await dbPromise).delete("outbox", clientId); window.dispatchEvent(new CustomEvent("trs-outbox-change")); }
