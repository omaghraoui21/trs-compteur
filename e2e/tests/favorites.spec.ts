import { test, expect, DOWNTIME_CATEGORY, ADMIN_DOWNTIME_CATEGORY, SESSION, SESSION_DETAIL_EMPTY } from "../fixtures";

// ─── Favourite quick-stops ────────────────────────────────────────────────────
// Admin marks downtime categories as favourites (★); the operator main screen
// shows them as one-tap chrono buttons (tap = start, tap again = stop + record).

test.describe("Admin — favourite downtime categories", () => {
  test("star toggle marks a category as favourite", async ({ adminPage: page }) => {
    let body: any = null;
    await page.route(/\/api\/admin\/downtime-categories\/cat-1$/, (r) => {
      body = JSON.parse(r.request().postData() || "{}");
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...ADMIN_DOWNTIME_CATEGORY, isFavorite: true }) });
    });
    await page.goto("/admin");
    await page.getByRole("tab", { name: /arrêts/i }).click();
    await expect(page.getByText("Panne machine")).toBeVisible();
    await page.getByRole("button", { name: /ajouter .* aux favoris/i }).first().click();
    await expect.poll(() => body).toMatchObject({ isFavorite: true });
  });
});

test.describe("Operator — favourite quick-stops", () => {
  const FAV = { ...DOWNTIME_CATEGORY, label: "Bouchage blistéreuse", isFavorite: true, favoriteOrder: 1 };

  test.beforeEach(async ({ operatorPage: page }) => {
    await page.route(/\/api\/ref\/downtime-categories/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([FAV]) }));
    await page.route(/\/api\/sessions\?/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([SESSION]) }));
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }));
    await page.goto("/");
    await page.getByText(/Salle de Production/i).click();
    await page.getByText(/Blistereuse IMA/i).click();
    await expect(page.getByRole("heading", { name: /arrêts favoris/i })).toBeVisible();
  });

  test("the favourite appears on the main screen", async ({ operatorPage: page }) => {
    await expect(page.getByRole("button", { name: /bouchage blistéreuse/i })).toBeVisible();
  });

  test("tap starts the chrono, tap again records the stop", async ({ operatorPage: page }) => {
    let posted: any = null;
    await page.route(/\/api\/sessions\/session-1\/downtimes/, (r) => {
      posted = JSON.parse(r.request().postData() || "{}");
      r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "dt-x" }) });
    });
    const btn = page.getByRole("button", { name: /bouchage blistéreuse/i });
    await btn.click();                                   // start chrono
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await btn.click();                                   // stop + record
    await expect.poll(() => posted).toMatchObject({ categoryId: "cat-1" });
    // Specific to the success toast (the timeline empty-state also contains
    // "…arrêts enregistrés…", so a bare /enregistré/i is ambiguous).
    await expect(page.getByText(/« Bouchage blistéreuse » enregistré/i)).toBeVisible();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});
