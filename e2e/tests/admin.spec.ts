import { test, expect, ADMIN_EQUIPMENT } from "../fixtures";

// ─── Admin / Configuration page ───────────────────────────────────────────────
// The Configuration page is the only major page with no E2E coverage; these
// smoke tests guard its render + tab navigation against silent regressions.

test.describe("Admin — Configuration", () => {
  test("renders the Configuration page with its tabs", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /configuration/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /locaux/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /équipements/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /utilisateurs/i })).toBeVisible();
  });

  test("Locaux tab lists the seeded room", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await expect(page.getByText("Salle de Production")).toBeVisible();
    await expect(page.getByText("SP-01")).toBeVisible();
  });

  test("switching to Équipements shows the equipment", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await page.getByRole("tab", { name: /équipements/i }).click();
    await expect(page.getByText(ADMIN_EQUIPMENT.name)).toBeVisible();
  });

  test("switching to Produits shows the product", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await page.getByRole("tab", { name: /produits/i }).click();
    await expect(page.getByText("Aeronide 200µg")).toBeVisible();
  });

  test("Utilisateurs tab lists users (admin-only)", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await page.getByRole("tab", { name: /utilisateurs/i }).click();
    await expect(page.getByText("admin@dpi.local")).toBeVisible();
  });

  test("shows the empty state when there are no rooms", async ({ adminPage: page }) => {
    // Override the rooms route to return an empty list.
    await page.unroute(/\/api\/admin\/rooms$/);
    await page.route(/\/api\/admin\/rooms$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.goto("/admin");
    await expect(page.getByText(/aucun local/i)).toBeVisible();
  });
});
