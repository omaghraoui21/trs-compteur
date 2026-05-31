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

  it("allows a supervisor to validate a lot (200)", async () => {
    const res = await request(app)
      .post(`/api/lots/${lotId}/validate`)
      .set({ Authorization: `Bearer ${supToken}` })
      .send({ action: "validate" });
    expect(res.status).toBe(200);
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

describe("DB hardening constraints", () => {
  it("rejects an out-of-range role at the DB boundary", async () => {
    await expect(
      sql`INSERT INTO users (email, password_hash, display_name, role)
          VALUES ('x@x.local', 'h', 'X', 'superuser')`,
    ).rejects.toThrow();
  });
});
