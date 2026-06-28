import { test, expect } from "../fixtures";

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
