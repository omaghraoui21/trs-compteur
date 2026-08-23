import { test as base, expect, type Page } from "@playwright/test";
import {
  OPERATOR_USER, ADMIN_USER,
  mockAuthRoutes, mockRefRoutes, mockSessionRoutes, mockLotRoutes, mockAdminRoutes,
  SESSION, SESSION_DETAIL_EMPTY,
} from "../fixtures/index";

const PHASE = process.env.TOUR_PHASE || "before";
const d = (project: string) => `artifacts/${PHASE}/${project}/ix`;

async function injectTokens(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("trs_token", "fake-access-token");
    localStorage.setItem("trs_refresh", "fake-refresh-token");
    localStorage.setItem("trs_onboarding_done", "1");
  });
}

const test = base;

// Navigate room → equipment; with /api/sessions? returning an active session
// the Compteur auto-resumes into the timeline view.
async function enterActiveSession(page: Page) {
  await page.goto("/");
  await page.waitForTimeout(500);
  const room = page.getByText(/Salle de Production/i).first();
  if (await room.count()) { await room.click(); await page.waitForTimeout(300); }
  const equip = page.getByText(/Blistereuse IMA/i).first();
  if (await equip.count()) { await equip.click(); await page.waitForTimeout(600); }
}

test.describe("interactions", () => {
  test("login error + password toggle", async ({ page }, info) => {
    const dir = d(info.project.name);
    await page.route(/\/api\/auth\/me/, (r) => r.fulfill({ status: 401, body: "{}" }));
    await page.route(/\/api\/auth\/login/, (r) =>
      r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Identifiants invalides" }) }));
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("wrong@example.com");
    await page.locator("#login-password").fill("badpassword");
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/50-login-error.png`, fullPage: true });
    // reveal password
    await page.getByRole("button", { name: /afficher le mot de passe/i }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}/51-login-password-visible.png`, fullPage: true });
  });

  test("operator declare-downtime form", async ({ page }, info) => {
    const dir = d(info.project.name);
    await injectTokens(page);
    await mockAuthRoutes(page, OPERATOR_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);
    await page.route(/\/api\/sessions\?/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([SESSION]) }));
    await page.route(/\/api\/sessions\/session-1$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }));
    await enterActiveSession(page);
    const declare = page.getByRole("button", { name: /déclarer un arrêt/i }).first();
    if (await declare.count()) { await declare.click(); await page.waitForTimeout(400); }
    await page.screenshot({ path: `${dir}/52-downtime-form.png`, fullPage: true });
  });

  test("operator end-of-shift modal", async ({ page }, info) => {
    const dir = d(info.project.name);
    await injectTokens(page);
    await mockAuthRoutes(page, OPERATOR_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);
    await page.route(/\/api\/sessions\?/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([SESSION]) }));
    await page.route(/\/api\/sessions\/session-1$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }));
    await enterActiveSession(page);
    const close = page.getByRole("button", { name: /fermer la session/i }).first();
    if (await close.count()) { await close.click(); await page.waitForTimeout(400); }
    await page.screenshot({ path: `${dir}/53-end-of-shift-modal.png`, fullPage: true });
  });

  test("change-password modal", async ({ page }, info) => {
    const dir = d(info.project.name);
    await injectTokens(page);
    await mockAuthRoutes(page, OPERATOR_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);
    await page.goto("/");
    await page.waitForTimeout(500);
    const key = page.getByRole("button", { name: /changer mon mot de passe/i }).first();
    if (await key.count()) { await key.click(); await page.waitForTimeout(300); }
    await page.screenshot({ path: `${dir}/54-change-password-modal.png`, fullPage: true });
  });

  test("admin create-room form", async ({ page }, info) => {
    const dir = d(info.project.name);
    await injectTokens(page);
    await mockAuthRoutes(page, ADMIN_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockAdminRoutes(page);
    await page.goto("/admin");
    await page.waitForTimeout(700);
    const add = page.getByRole("button", { name: /ajouter/i }).first();
    if (await add.count()) { await add.click(); await page.waitForTimeout(300); }
    await page.screenshot({ path: `${dir}/55-admin-create-form.png`, fullPage: true });
  });
});
