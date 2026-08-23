import { test, expect, mockDashboardRoutes } from "../fixtures";

// ─── API-failure resilience ───────────────────────────────────────────────────
// Regression guard for the 2026-06 outage: when an endpoint 500s, the page must
// degrade gracefully (heading still rendered, no ErrorBoundary white-screen),
// not crash the whole view.

test.describe("Resilience — pages survive API 500s", () => {
  test("supervisor queue shows its header (no white-screen) when pending-lots 500s", async ({ supervisorPage: page }) => {
    await page.route(/\/api\/dashboard\/pending-lots/, (r) =>
      r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Erreur serveur" }) }));
    await page.goto("/supervisor");
    await expect(page.getByRole("heading", { name: /validation des lots/i })).toBeVisible();
    // The ErrorBoundary fallback must NOT be shown.
    await expect(page.getByText(/erreur sur la page/i)).toHaveCount(0);
  });

  test("dashboard shows its header (no white-screen) when /trs 500s", async ({ supervisorPage: page }) => {
    await mockDashboardRoutes(page);
    await page.unroute(/\/api\/dashboard\/trs/);
    await page.route(/\/api\/dashboard\/trs/, (r) =>
      r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Erreur serveur" }) }));
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /tableau de bord/i })).toBeVisible();
    await expect(page.getByText(/erreur sur la page/i)).toHaveCount(0);
  });

  test("admin Arrêts shows an error banner (not a crash) when categories 500", async ({ adminPage: page }) => {
    await page.unroute(/\/api\/admin\/downtime-categories$/);
    await page.route(/\/api\/admin\/downtime-categories$/, (r) =>
      r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Erreur serveur" }) }));
    await page.goto("/admin");
    await page.getByRole("tab", { name: /arrêts/i }).click();
    await expect(page.getByText(/erreur serveur/i)).toBeVisible();
    await expect(page.getByText(/erreur sur la page/i)).toHaveCount(0);
  });
});
