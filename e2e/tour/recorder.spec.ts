import { test as base, expect, type Page } from "@playwright/test";
import {
  OPERATOR_USER, SUPERVISOR_USER, ADMIN_USER,
  mockAuthRoutes, mockRefRoutes, mockSessionRoutes, mockLotRoutes, mockDashboardRoutes,
  mockAdminRoutes,
  SESSION, SESSION_DETAIL_EMPTY, TRS_EMPTY,
} from "../fixtures/index";

const PHASE = process.env.TOUR_PHASE || "before";

function dir(project: string) {
  return `artifacts/${PHASE}/${project}`;
}

async function injectTokens(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("trs_token", "fake-access-token");
    localStorage.setItem("trs_refresh", "fake-refresh-token");
    localStorage.setItem("trs_onboarding_done", "1");
  });
}

// Collect console errors per page so the tour doubles as a smoke test.
function watchErrors(page: Page, sink: string[]) {
  page.on("console", (m) => { if (m.type() === "error") sink.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => sink.push(`pageerror: ${e.message}`));
}

const test = base;

test.describe("tour", () => {
  test("login flow", async ({ page }, info) => {
    const errs: string[] = [];
    watchErrors(page, errs);
    const d = dir(info.project.name);

    await page.route(/\/api\/auth\/login/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        token: "valid-access-token", refreshToken: "valid-refresh-token", user: OPERATOR_USER,
      }) }));
    await page.route(/\/api\/auth\/me/, (r) => r.fulfill({ status: 401, body: "{}" }));
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);

    await page.goto("/login");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${d}/01-login-empty.png`, fullPage: true });

    await page.getByLabel(/email/i).fill("operateur@dpi.local");
    await page.locator("#login-password").fill("oper123");
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${d}/02-login-filled.png`, fullPage: true });

    // flip me to 200 so the app stays authenticated post-login
    await page.unroute(/\/api\/auth\/me/);
    await page.route(/\/api\/auth\/me/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OPERATOR_USER) }));
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${d}/03-after-login.png`, fullPage: true });

    // Fail only on uncaught exceptions (page crashes); mock-gap 500s are noise.
    const crashes = errs.filter((e) => e.startsWith("pageerror:"));
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("operator flow", async ({ page }, info) => {
    const errs: string[] = [];
    watchErrors(page, errs);
    const d = dir(info.project.name);

    await injectTokens(page);
    await mockAuthRoutes(page, OPERATOR_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);

    await page.goto("/");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${d}/10-operator-room-picker.png`, fullPage: true });

    // pick room
    const room = page.getByText(/Salle de Production/i).first();
    if (await room.count()) { await room.click(); await page.waitForTimeout(400); }
    await page.screenshot({ path: `${d}/11-operator-after-room.png`, fullPage: true });

    // pick equipment
    const equip = page.getByText(/Blistereuse IMA/i).first();
    if (await equip.count()) { await equip.click(); await page.waitForTimeout(400); }
    await page.screenshot({ path: `${d}/12-operator-equipment.png`, fullPage: true });

    // open a session
    const openBtn = page.getByRole("button", { name: /ouvrir|démarrer|commencer/i }).first();
    if (await openBtn.count()) {
      // after opening, GET /sessions should now return active session + detail
      await page.unroute(/\/api\/sessions\?/);
      await page.route(/\/api\/sessions\?/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([SESSION]) }));
      await openBtn.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: `${d}/13-operator-session-open.png`, fullPage: true });

    // try opening the new-lot form
    const newLot = page.getByRole("button", { name: /nouveau lot/i }).first();
    if (await newLot.count()) { await newLot.click(); await page.waitForTimeout(400); }
    await page.screenshot({ path: `${d}/14-operator-new-lot-form.png`, fullPage: true });

    // Fail only on uncaught exceptions (page crashes); mock-gap 500s are noise.
    const crashes = errs.filter((e) => e.startsWith("pageerror:"));
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("supervisor flow", async ({ page }, info) => {
    const errs: string[] = [];
    watchErrors(page, errs);
    const d = dir(info.project.name);

    await injectTokens(page);
    await mockAuthRoutes(page, SUPERVISOR_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);
    await mockDashboardRoutes(page);

    await page.goto("/supervisor");
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${d}/20-supervisor-queue.png`, fullPage: true });

    // expand first lot card
    const lot = page.getByText("26013").first();
    if (await lot.count()) { await lot.click(); await page.waitForTimeout(400); }
    await page.screenshot({ path: `${d}/21-supervisor-expanded.png`, fullPage: true });

    // open validation modal
    const valider = page.getByRole("button", { name: /^valider/i }).first();
    if (await valider.count()) { await valider.click(); await page.waitForTimeout(400); }
    await page.screenshot({ path: `${d}/22-supervisor-validate-modal.png`, fullPage: true });

    // Fail only on uncaught exceptions (page crashes); mock-gap 500s are noise.
    const crashes = errs.filter((e) => e.startsWith("pageerror:"));
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("dashboard flow", async ({ page }, info) => {
    const errs: string[] = [];
    watchErrors(page, errs);
    const d = dir(info.project.name);

    await injectTokens(page);
    await mockAuthRoutes(page, SUPERVISOR_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);
    await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${d}/30-dashboard.png`, fullPage: true });

    // toggle custom date range
    const custom = page.getByText(/personnalis/i).first();
    if (await custom.count()) { await custom.click().catch(() => {}); await page.waitForTimeout(400); }
    await page.screenshot({ path: `${d}/31-dashboard-custom.png`, fullPage: true });

    // Fail only on uncaught exceptions (page crashes); mock-gap 500s are noise.
    const crashes = errs.filter((e) => e.startsWith("pageerror:"));
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("admin flow", async ({ page }, info) => {
    const errs: string[] = [];
    watchErrors(page, errs);
    const d = dir(info.project.name);

    await injectTokens(page);
    await mockAuthRoutes(page, ADMIN_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);
    await mockDashboardRoutes(page);
    await mockAdminRoutes(page);

    await page.goto("/admin");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${d}/40-admin.png`, fullPage: true });

    // click through the Configuration tabs
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const label = (await tabs.nth(i).innerText().catch(() => "")).trim();
      if (/produit|équipement|equipement|local|locaux|cadence|arrêt|arret|utilisateur|audit/i.test(label)) {
        await tabs.nth(i).click().catch(() => {});
        await page.waitForTimeout(350);
        await page.screenshot({ path: `${d}/41-admin-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, fullPage: true });
      }
    }

    // Fail only on uncaught exceptions (page crashes); mock-gap 500s are noise.
    const crashes = errs.filter((e) => e.startsWith("pageerror:"));
    expect(crashes, crashes.join("\n")).toEqual([]);
  });
});
