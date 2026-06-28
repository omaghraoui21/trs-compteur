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

  test("Ajouter opens the create-room form", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: /ajouter/i }).click();
    await expect(page.getByRole("heading", { name: /nouveau local/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /enregistrer/i })).toBeVisible();
  });
});

test.describe("Admin — delete confirmation", () => {
  test("Escape closes the confirmation modal", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: /désactiver/i }).first().click();
    await expect(page.getByText(/désactiver le local/i)).toBeVisible();
    // Regression: focus is moved into the dialog so Escape dismisses it.
    await page.keyboard.press("Escape");
    await expect(page.getByText(/désactiver le local/i)).not.toBeVisible();
  });

  test("Confirmer issues the delete and shows a success toast", async ({ adminPage: page }) => {
    let deleted = false;
    await page.route(/\/api\/admin\/rooms\/room-1$/, (r) => {
      deleted = true;
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.goto("/admin");
    await page.getByRole("button", { name: /désactiver/i }).first().click();
    await page.getByRole("button", { name: /confirmer/i }).click();
    await expect(page.getByText(/désactivé/i)).toBeVisible();
    expect(deleted, "DELETE must be issued on confirm").toBe(true);
  });

  test("Annuler closes the modal without deleting", async ({ adminPage: page }) => {
    let deleted = false;
    await page.route(/\/api\/admin\/rooms\/room-1$/, (r) => { deleted = true; r.fulfill({ status: 200, body: "{}" }); });
    await page.goto("/admin");
    await page.getByRole("button", { name: /désactiver/i }).first().click();
    await page.getByRole("button", { name: /annuler/i }).click();
    await expect(page.getByText(/désactiver le local/i)).not.toBeVisible();
    expect(deleted, "DELETE must not be issued on cancel").toBe(false);
  });
});

test.describe("Admin — user deactivation modal", () => {
  const OTHER_USER = { id: "user-op-9", email: "op9@dpi.local", displayName: "Opérateur Neuf", role: "operator", isActive: true, createdAt: "2026-01-01T00:00:00.000Z" };

  test.beforeEach(async ({ adminPage: page }) => {
    // List a non-self user so its deactivate toggle is enabled.
    await page.unroute(/\/api\/admin\/users$/);
    await page.route(/\/api\/admin\/users$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([OTHER_USER]) }));
    await page.goto("/admin");
    await page.getByRole("tab", { name: /utilisateurs/i }).click();
    await expect(page.getByText("op9@dpi.local")).toBeVisible();
  });

  test("deactivation opens the accessible modal (not window.confirm) and Escape closes it", async ({ adminPage: page }) => {
    await page.getByRole("button", { name: /actif/i }).click();
    await expect(page.getByText(/désactiver l'utilisateur/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(/désactiver l'utilisateur/i)).not.toBeVisible();
  });

  test("confirming deactivation PATCHes the user inactive", async ({ adminPage: page }) => {
    let body: any = null;
    await page.route(/\/api\/admin\/users\/user-op-9$/, (r) => {
      body = JSON.parse(r.request().postData() || "{}");
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...OTHER_USER, isActive: false }) });
    });
    await page.getByRole("button", { name: /actif/i }).click();
    await page.getByRole("button", { name: /confirmer/i }).click();
    await expect(page.getByText(/désactivé/i)).toBeVisible();
    expect(body).toMatchObject({ isActive: false });
  });
});
