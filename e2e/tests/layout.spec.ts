import { test, expect } from "../fixtures";

// ─── App shell: role-based navigation ─────────────────────────────────────────
// The "Configuration" entry is gated to admin/supervisor (navItems roles).

test.describe("Navigation RBAC", () => {
  test("operator sees Session/Validation/Dashboard but not Configuration", async ({ operatorPage: page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /session/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /validation/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /tableau de bord/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /configuration/i })).toHaveCount(0);
  });

  test("admin sees the Configuration entry", async ({ adminPage: page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /configuration/i })).toBeVisible();
  });
});

// ─── App shell: change-password modal ─────────────────────────────────────────
// The modal lives in Layout and is reachable from every authenticated page via
// the header key button. Covers its client-side validation + success path.

test.describe("Change-password modal", () => {
  test("mismatched passwords show an error and do not submit", async ({ operatorPage: page }) => {
    let called = false;
    await page.route(/\/api\/auth\/change-password/, (r) => { called = true; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });

    await page.goto("/");
    await page.getByRole("button", { name: /changer mon mot de passe/i }).click();
    await page.getByLabel("Mot de passe actuel").fill("oldpass1");
    await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("newpass1");
    await page.getByLabel("Confirmation du nouveau mot de passe").fill("different");
    await page.getByRole("button", { name: /^changer$/i }).click();

    await expect(page.getByText(/ne correspondent pas/i)).toBeVisible();
    expect(called, "API must not be called when passwords mismatch").toBe(false);
  });

  test("matching passwords submit and show success", async ({ operatorPage: page }) => {
    await page.route(/\/api\/auth\/change-password/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
    );

    await page.goto("/");
    await page.getByRole("button", { name: /changer mon mot de passe/i }).click();
    await page.getByLabel("Mot de passe actuel").fill("oldpass1");
    await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("newpass1");
    await page.getByLabel("Confirmation du nouveau mot de passe").fill("newpass1");
    await page.getByRole("button", { name: /^changer$/i }).click();

    await expect(page.getByText(/mot de passe modifié/i)).toBeVisible();
  });
});
