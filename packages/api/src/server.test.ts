import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import { fileURLToPath } from "url";

// ════════════════════════════════════════════════════════════════════
// API integration tests — boot the real Express app against a throwaway
// Postgres, then assert the golden path, RBAC, Zod validation, and the
// audit-log immutability that the DB-hardening migration guarantees.
//
// Requires a reachable Postgres. Override the admin connection with
// TEST_PG_ADMIN_URL (defaults to the local dev instance). The suite
// creates a uniquely-named database and drops it on teardown.
// ════════════════════════════════════════════════════════════════════

const ADMIN_URL =
  process.env.TEST_PG_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const TEST_DB = `trs_apitest_${Date.now()}`;
const TEST_URL = ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/drizzle");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let sql: ReturnType<typeof postgres>;
let opToken: string;
let supToken: string;
let admToken: string;

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token;
}

beforeAll(async () => {
  // 1. Create the throwaway database.
  const admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  // 2. Point the app at it BEFORE importing anything that opens a connection.
  process.env.DATABASE_URL = TEST_URL;
  process.env.JWT_SECRET = "test-secret-key";
  process.env.NODE_ENV = "test";
  process.env.VERCEL = "1"; // skip app.listen() + boot-time auto-migrate

  // 3. Migrate + seed via the same paths production uses.
  sql = postgres(TEST_URL, { max: 1 });
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR });

  const { createDb } = await import("@trs/db");
  const { seedIfEmpty } = await import("./lib/seed");
  await seedIfEmpty(createDb(TEST_URL));

  // 4. Import the app (createDb() inside reads DATABASE_URL set above).
  ({ app } = await import("./server"));

  opToken = await login("operateur@dpi.local", "oper123");
  supToken = await login("superviseur@dpi.local", "super123");
  admToken = await login("admin@dpi.local", "admin123");
}, 60_000);

afterAll(async () => {
  await sql?.end();
  const admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
});

describe("auth", () => {
  it("issues a token + user for valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "operateur@dpi.local", password: "oper123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("operator");
  });

  it("rejects a bad password with 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "operateur@dpi.local", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400 (Zod validation)", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated access to a protected route with 401", async () => {
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(401);
  });
});

describe("golden path + validation + RBAC", () => {
  let equipmentId: string;
  let roomId: string;
  let productId: string;
  let categoryId: string;
  let sessionId: string;
  let lotId: string;

  it("loads reference data", async () => {
    const auth = { Authorization: `Bearer ${opToken}` };
    const eqs = await request(app).get("/api/ref/equipments").set(auth);
    const rooms = await request(app).get("/api/ref/rooms").set(auth);
    const products = await request(app).get("/api/ref/products").set(auth);
    const cats = await request(app).get("/api/ref/downtime-categories").set(auth);
    equipmentId = (eqs.body.equipments ?? eqs.body)[0].id;
    roomId = (rooms.body.rooms ?? rooms.body)[0].id;
    productId = (products.body.products ?? products.body)[0].id;
    categoryId = (cats.body.categories ?? cats.body).find((c: any) => !c.isPlanned).id;
    expect(equipmentId).toBeTruthy();
  });

  it("opens a session and starts a lot", async () => {
    const auth = { Authorization: `Bearer ${opToken}` };
    const ses = await request(app).post("/api/sessions/open").set(auth).send({ equipmentId, roomId });
    expect(ses.status).toBe(201);
    sessionId = ses.body.id ?? ses.body.session?.id;

    const lot = await request(app).post("/api/lots").set(auth).send({
      sessionId, productId, batchNumber: "TEST-LOT-1", cadenceUsed: 100, cadenceUnit: "u/min",
    });
    expect(lot.status).toBe(201);
    lotId = lot.body.id ?? lot.body.lot?.id;
    expect(lotId).toBeTruthy();
  });

  it("records a downtime (201)", async () => {
    const res = await request(app)
      .post(`/api/lots/${lotId}/downtimes`)
      .set({ Authorization: `Bearer ${opToken}` })
      .send({ categoryId, durationMinutes: 12 });
    expect(res.status).toBe(201);
  });

  it("returns downtimes with the category joined server-side", async () => {
    const res = await request(app)
      .get(`/api/lots/${lotId}/downtimes`)
      .set({ Authorization: `Bearer ${opToken}` });
    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty("famille");
    expect(res.body[0]).toHaveProperty("reason");
    expect(res.body[0]).toHaveProperty("isPlanned");
  });

  it("rejects conforming > produced with 400 (Zod refine)", async () => {
    const res = await request(app)
      .post(`/api/lots/${lotId}/close`)
      .set({ Authorization: `Bearer ${opToken}` })
      .send({ quantityProduced: 100, quantityConforming: 200 });
    expect(res.status).toBe(400);
  });

  it("closes the lot with valid quantities (200)", async () => {
    const res = await request(app)
      .post(`/api/lots/${lotId}/close`)
      .set({ Authorization: `Bearer ${opToken}` })
      .send({ quantityProduced: 5000, quantityConforming: 4800, quantityRejected: 200 });
    expect(res.status).toBe(200);
  });

  it("forbids an operator from validating a lot (403)", async () => {
    const res = await request(app)
      .post(`/api/lots/${lotId}/validate`)
      .set({ Authorization: `Bearer ${opToken}` })
      .send({ action: "validate" });
    expect(res.status).toBe(403);
  });

  it("requires a password to validate — 400 without it (Part 11 re-auth)", async () => {
    const res = await request(app)
      .post(`/api/lots/${lotId}/validate`)
      .set({ Authorization: `Bearer ${supToken}` })
      .send({ action: "validate" });
    expect(res.status).toBe(400);
  });

  it("rejects a wrong signing password with 401", async () => {
    const res = await request(app)
      .post(`/api/lots/${lotId}/validate`)
      .set({ Authorization: `Bearer ${supToken}` })
      .send({ action: "validate", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("allows a supervisor to validate with re-auth (200) and records a signature", async () => {
    const res = await request(app)
      .post(`/api/lots/${lotId}/validate`)
      .set({ Authorization: `Bearer ${supToken}` })
      .send({ action: "validate", password: "super123" });
    expect(res.status).toBe(200);
    expect(res.body.signature).toBeTruthy();
    expect(res.body.signature.meaning).toBe("Validation du lot");
    expect(res.body.signature.userEmail).toBe("superviseur@dpi.local");
  });

  it("exposes the lot's electronic signatures (Part 11 manifestation)", async () => {
    const res = await request(app)
      .get(`/api/lots/${lotId}/signatures`)
      .set({ Authorization: `Bearer ${supToken}` });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty("signedAt");
    expect(res.body[0].meaning).toBe("Validation du lot");
  });

  it("closes the session (200)", async () => {
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/close`)
      .set({ Authorization: `Bearer ${opToken}` })
      .send({});
    expect(res.status).toBe(200);
  });
});

describe("audit trail (21 CFR-style traceability)", () => {
  it("wrote append-only audit rows for the golden-path actions", async () => {
    const rows = await sql`SELECT action FROM audit_log ORDER BY created_at`;
    const actions = rows.map((r: any) => r.action);
    expect(actions.length).toBeGreaterThan(0);
    // Lot validation must be traceable
    expect(actions.some((a: string) => /VALIDATE/i.test(a))).toBe(true);
  });

  it("blocks UPDATE on audit_log (immutability trigger)", async () => {
    await expect(
      sql`UPDATE audit_log SET action = 'TAMPERED' WHERE true`,
    ).rejects.toThrow(/append-only/i);
  });

  it("blocks DELETE on audit_log (immutability trigger)", async () => {
    await expect(sql`DELETE FROM audit_log WHERE true`).rejects.toThrow(/append-only/i);
  });
});

describe("electronic signatures (21 CFR Part 11)", () => {
  it("blocks UPDATE on electronic_signatures (immutability trigger)", async () => {
    await expect(
      sql`UPDATE electronic_signatures SET meaning = 'TAMPERED' WHERE true`,
    ).rejects.toThrow(/append-only/i);
  });

  it("blocks DELETE on electronic_signatures (immutability trigger)", async () => {
    await expect(sql`DELETE FROM electronic_signatures WHERE true`).rejects.toThrow(/append-only/i);
  });

  it("captured the three Part 11 components (who / meaning / when)", async () => {
    const rows = await sql`SELECT user_email, user_name, meaning, signed_at FROM electronic_signatures LIMIT 1`;
    expect(rows.length).toBe(1);
    expect(rows[0].user_email).toBeTruthy();
    expect(rows[0].user_name).toBeTruthy();
    expect(rows[0].meaning).toBeTruthy();
    expect(rows[0].signed_at).toBeTruthy();
  });
});

describe("user management (admin-only)", () => {
  const adm = () => ({ Authorization: `Bearer ${admToken}` });
  let createdUserId: string;
  let selfId: string;

  it("forbids a supervisor from listing users (403)", async () => {
    const res = await request(app).get("/api/admin/users").set({ Authorization: `Bearer ${supToken}` });
    expect(res.status).toBe(403);
  });

  it("lets an admin list users without exposing password hashes", async () => {
    const res = await request(app).get("/api/admin/users").set(adm());
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    expect(res.body[0]).not.toHaveProperty("passwordHash");
    selfId = res.body.find((u: any) => u.email === "admin@dpi.local").id;
  });

  it("creates a new user (201) who can then log in", async () => {
    const res = await request(app).post("/api/admin/users").set(adm()).send({
      email: "nouveau@dpi.local", displayName: "Nouveau", password: "secret123", role: "operator",
    });
    expect(res.status).toBe(201);
    createdUserId = res.body.id;
    const loginRes = await request(app).post("/api/auth/login").send({ email: "nouveau@dpi.local", password: "secret123" });
    expect(loginRes.status).toBe(200);
  });

  it("rejects a duplicate email (409)", async () => {
    const res = await request(app).post("/api/admin/users").set(adm()).send({
      email: "nouveau@dpi.local", displayName: "Dup", password: "secret123", role: "operator",
    });
    expect(res.status).toBe(409);
  });

  it("rejects a too-short password (400 Zod)", async () => {
    const res = await request(app).post("/api/admin/users").set(adm()).send({
      email: "x@dpi.local", displayName: "X", password: "123", role: "operator",
    });
    expect(res.status).toBe(400);
  });

  it("deactivates a user, blocking their login (401)", async () => {
    const res = await request(app).patch(`/api/admin/users/${createdUserId}`).set(adm()).send({ isActive: false });
    expect(res.status).toBe(200);
    const loginRes = await request(app).post("/api/auth/login").send({ email: "nouveau@dpi.local", password: "secret123" });
    expect(loginRes.status).toBe(401);
  });

  it("resets a user's password (new password works)", async () => {
    await request(app).patch(`/api/admin/users/${createdUserId}`).set(adm()).send({ isActive: true });
    const res = await request(app).post(`/api/admin/users/${createdUserId}/password`).set(adm()).send({ password: "changed123" });
    expect(res.status).toBe(200);
    const loginRes = await request(app).post("/api/auth/login").send({ email: "nouveau@dpi.local", password: "changed123" });
    expect(loginRes.status).toBe(200);
  });

  it("prevents an admin from deactivating their own account (400)", async () => {
    const res = await request(app).patch(`/api/admin/users/${selfId}`).set(adm()).send({ isActive: false });
    expect(res.status).toBe(400);
  });

  it("prevents an admin from demoting their own role (400)", async () => {
    const res = await request(app).patch(`/api/admin/users/${selfId}`).set(adm()).send({ role: "operator" });
    expect(res.status).toBe(400);
  });

  it("writes audit rows for user actions", async () => {
    const rows = await sql`SELECT action FROM audit_log WHERE entity_type = 'user'`;
    const actions = rows.map((r: any) => r.action);
    expect(actions).toContain("CREATE_USER");
    expect(actions).toContain("RESET_PASSWORD");
  });
});

describe("self-service password change", () => {
  const auth = () => ({ Authorization: `Bearer ${opToken}` });

  it("rejects a wrong current password (401)", async () => {
    const res = await request(app).post("/api/auth/change-password").set(auth()).send({ oldPassword: "nope", newPassword: "whatever123" });
    expect(res.status).toBe(401);
  });

  it("rejects a too-short new password (400)", async () => {
    const res = await request(app).post("/api/auth/change-password").set(auth()).send({ oldPassword: "oper123", newPassword: "123" });
    expect(res.status).toBe(400);
  });

  it("changes the password (new one works), then reverts", async () => {
    const r1 = await request(app).post("/api/auth/change-password").set(auth()).send({ oldPassword: "oper123", newPassword: "newpass123" });
    expect(r1.status).toBe(200);
    const login1 = await request(app).post("/api/auth/login").send({ email: "operateur@dpi.local", password: "newpass123" });
    expect(login1.status).toBe(200);
    // revert so seed credentials stay consistent for any later runs
    const r2 = await request(app).post("/api/auth/change-password").set({ Authorization: `Bearer ${login1.body.token}` }).send({ oldPassword: "newpass123", newPassword: "oper123" });
    expect(r2.status).toBe(200);
  });
});

describe("DB hardening constraints", () => {
  it("rejects an out-of-range role at the DB boundary", async () => {
    await expect(
      sql`INSERT INTO users (email, password_hash, display_name, role)
          VALUES ('x@x.local', 'h', 'X', 'superuser')`,
    ).rejects.toThrow();
  });
});

describe("session-level stops + cadence changes (refonte arrêts)", () => {
  const auth = { Authorization: `Bearer ${""}` };
  let equipmentId: string;
  let roomId: string;
  let productId: string;
  let plannedCatId: string;
  let sessionId: string;

  it("sets up reference data + a session", async () => {
    auth.Authorization = `Bearer ${opToken}`;
    const eqs = await request(app).get("/api/ref/equipments").set(auth);
    const rooms = await request(app).get("/api/ref/rooms").set(auth);
    const products = await request(app).get("/api/ref/products").set(auth);
    const cats = await request(app).get("/api/ref/downtime-categories").set(auth);
    equipmentId = (eqs.body.equipments ?? eqs.body)[0].id;
    roomId = (rooms.body.rooms ?? rooms.body)[0].id;
    productId = (products.body.products ?? products.body)[0].id;
    plannedCatId = (cats.body.categories ?? cats.body).find((c: any) => c.isPlanned).id;
    const ses = await request(app).post("/api/sessions/open").set(auth).send({ equipmentId, roomId });
    expect(ses.status).toBe(201);
    sessionId = ses.body.id ?? ses.body.session?.id;
  });

  it("records a SESSION-LEVEL planned stop (no active lot) → counts toward tAP", async () => {
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/downtimes`)
      .set(auth)
      .send({ categoryId: plannedCatId, durationMinutes: 25 });
    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBe(sessionId);
    expect(res.body.lotEntryId).toBeNull();

    const trs = await request(app).get(`/api/sessions/${sessionId}/trs`).set(auth);
    expect(trs.status).toBe(200);
    expect(trs.body.session.tAP).toBe(25);          // planned session stop → tAP
    expect(trs.body).toHaveProperty("aClasserMin"); // unclassified-time field present
  });

  it("session detail returns session-level downtimes", async () => {
    const res = await request(app).get(`/api/sessions/${sessionId}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.downtimes.some((d: any) => d.sessionId === sessionId && d.lotEntryId === null)).toBe(true);
  });

  it("logs cadence changes during a lot and exposes the history", async () => {
    const lot = await request(app).post("/api/lots").set(auth).send({
      sessionId, productId, batchNumber: "CAD-LOT", cadenceUsed: 120, cadenceUnit: "u/min",
    });
    expect(lot.status).toBe(201);
    const lotId = lot.body.id ?? lot.body.lot?.id;

    const c1 = await request(app).post(`/api/lots/${lotId}/cadence`).set(auth).send({ newCadence: 150, reason: "montée" });
    expect(c1.status).toBe(200);
    expect(Number(c1.body.cadenceUsed)).toBe(150);

    const hist = await request(app).get(`/api/lots/${lotId}/cadence`).set(auth);
    expect(hist.status).toBe(200);
    expect(hist.body.length).toBe(1);
    expect(Number(hist.body[0].oldCadence)).toBe(120);
    expect(Number(hist.body[0].newCadence)).toBe(150);

    // Close the lot, then a cadence change must be refused (409).
    await request(app).post(`/api/lots/${lotId}/close`).set(auth).send({ quantityProduced: 100, quantityConforming: 100 });
    const c2 = await request(app).post(`/api/lots/${lotId}/cadence`).set(auth).send({ newCadence: 90 });
    expect(c2.status).toBe(409);
  });
});
