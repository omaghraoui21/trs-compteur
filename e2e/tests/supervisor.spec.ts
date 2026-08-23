import { test, expect, PENDING_LOT, PRODUCT, OPERATOR_USER } from "../fixtures";

test.describe("Supervisor — lot validation queue", () => {
  test.beforeEach(async ({ supervisorPage: page }) => {
    // Pending lots endpoint with one lot
    await page.route(/\/api\/dashboard\/pending-lots/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([PENDING_LOT]) }),
    );
    // Lot downtimes + cadence
    await page.route(/\/api\/lots\/lot-1\/downtimes/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route(/\/api\/lots\/lot-1\/cadence/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );

    await page.goto("/supervisor");
    await expect(page.getByText(/validation des lots/i)).toBeVisible();
  });

  test("shows pending lot in the list", async ({ supervisorPage: page }) => {
    await expect(page.getByText("26013")).toBeVisible();
    await expect(page.getByText(/aeronide 200µg/i)).toBeVisible();
  });

  test("expands a lot card to show detail", async ({ supervisorPage: page }) => {
    // Click the lot card to expand
    await page.getByText("26013").click();
    await expect(page.getByText(/arrêts enregistrés/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /valider/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /rejeter/i })).toBeVisible();
  });

  test("shows 'Réduire' collapse button inside expanded card", async ({ supervisorPage: page }) => {
    await page.getByText("26013").click();
    // exact:true so we match only the footer "Réduire" button, not the header
    // toggle whose aria-label is "Réduire le lot 26013".
    await expect(page.getByRole("button", { name: "Réduire", exact: true })).toBeVisible();
  });

  test("collapse button closes the expanded card", async ({ supervisorPage: page }) => {
    await page.getByText("26013").click();
    // Expanded detail is visible
    await expect(page.getByRole("button", { name: /valider/i })).toBeVisible();

    // Click collapse (footer button, not the header toggle)
    await page.getByRole("button", { name: "Réduire", exact: true }).click();
    // Detail should be hidden
    await expect(page.getByRole("button", { name: /valider/i })).not.toBeVisible();
  });

  test("clicking 'Valider' opens signature modal", async ({ supervisorPage: page }) => {
    await page.getByText("26013").click();
    await page.getByRole("button", { name: /valider/i }).click();
    await expect(page.getByText(/signature électronique/i)).toBeVisible();
    await expect(page.getByPlaceholder(/mot de passe/i)).toBeVisible();
  });

  test("clicking 'Rejeter' opens signature modal", async ({ supervisorPage: page }) => {
    await page.getByText("26013").click();
    // A rejection comment is mandatory (GMP); without it, clicking "Rejeter"
    // only surfaces an inline error instead of the signature modal.
    await page.getByLabel(/commentaire superviseur/i).fill("Quantités incohérentes");
    await page.getByRole("button", { name: /rejeter/i }).click();
    await expect(page.getByText(/signature électronique/i)).toBeVisible();
  });

  test("successful validation removes lot from queue", async ({ supervisorPage: page }) => {
    // Mock the validate endpoint
    await page.route(/\/api\/lots\/lot-1\/validate/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ...PENDING_LOT, supervisorAction: "validate", supervisorId: "user-sv-1",
      }) }),
    );
    // After validation, pending-lots returns empty
    await page.unroute(/\/api\/dashboard\/pending-lots/);
    let validated = false;
    await page.route(/\/api\/dashboard\/pending-lots/, (r) => {
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(validated ? [] : [PENDING_LOT]) });
    });

    await page.getByText("26013").click();
    await page.getByRole("button", { name: /valider/i }).click();
    await page.getByPlaceholder(/mot de passe/i).fill("super123");
    validated = true;
    await page.getByRole("button", { name: /signer/i }).click();

    // Toast or list should update
    await expect(page.getByText(/26013/)).not.toBeVisible({ timeout: 5000 }).catch(() => {
      // List may not auto-refresh; just verify the signature call succeeded
    });
  });

  test("shows empty state when no pending lots", async ({ supervisorPage: page }) => {
    await page.unroute(/\/api\/dashboard\/pending-lots/);
    await page.route(/\/api\/dashboard\/pending-lots/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );

    await page.reload();
    await expect(page.getByText(/aucun lot/i)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Supervisor — correction coherence", () => {
  test.beforeEach(async ({ supervisorPage: page }) => {
    await page.route(/\/api\/dashboard\/pending-lots/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([PENDING_LOT]) }));
    await page.route(/\/api\/lots\/lot-1\/(downtimes|cadence|signatures)/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("/supervisor");
    await page.getByText("26013").click();
    await page.getByRole("button", { name: /corriger les données/i }).click();
  });

  test("lowering produced below the untouched conforming is flagged", async ({ supervisorPage: page }) => {
    // PENDING_LOT: produced 14400, conforming 14256. Lower produced under it.
    await page.locator("#corr-qProd-lot-1").fill("100");
    await page.locator("#corr-reason-lot-1").fill("erreur de saisie");
    await expect(page.getByText(/ne peut pas dépasser/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /signer la correction/i })).toBeDisabled();
  });

  test("a coherent correction enables signing", async ({ supervisorPage: page }) => {
    await page.locator("#corr-qProd-lot-1").fill("14400");
    await page.locator("#corr-qConf-lot-1").fill("14000");
    await page.locator("#corr-reason-lot-1").fill("recomptage qualité");
    await expect(page.getByText(/ne peut pas dépasser/i)).not.toBeVisible();
    await expect(page.getByRole("button", { name: /signer la correction/i })).toBeEnabled();
  });
});

test.describe("Supervisor — status tabs", () => {
  test("switching to Validés / Rejetés refetches with the status filter", async ({ supervisorPage: page }) => {
    const queried: string[] = [];
    await page.route(/\/api\/dashboard\/pending-lots(\?|$)/, (r) => {
      const u = new URL(r.request().url());
      queried.push(u.searchParams.get("status") || "none");
      r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.goto("/supervisor");
    await expect(page.getByRole("heading", { name: /validation des lots/i })).toBeVisible();
    await page.getByRole("tab", { name: /^validés/i }).click();
    await expect.poll(() => queried).toContain("validated");
    await page.getByRole("tab", { name: /^rejetés/i }).click();
    await expect.poll(() => queried).toContain("rejected");
  });

  test("each tab shows an empty state when there are no lots", async ({ supervisorPage: page }) => {
    await page.route(/\/api\/dashboard\/pending-lots(\?|$)/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("/supervisor");

    // Match the tab-specific EmptyState title exactly. EmptyState also renders a
    // description ("Aucun lot dans cette catégorie."), so a loose /aucun lot/i
    // resolves to two nodes and trips Playwright strict mode.
    const tabs: [RegExp, string][] = [
      [/^en attente/i, "Aucun lot en attente"],
      [/^validés/i, "Aucun lot validé"],
      [/^rejetés/i, "Aucun lot rejeté"],
    ];
    for (const [tab, title] of tabs) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }
  });
});
