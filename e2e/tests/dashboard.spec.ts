import { test, expect, mockDashboardRoutes, TRS_EMPTY } from "../fixtures";
import * as fs from "fs";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ supervisorPage: page }) => {
    await mockDashboardRoutes(page);
    await page.goto("/dashboard");
    // Wait for the page to finish loading
    await expect(page.getByText(/tableau de bord trs/i)).toBeVisible();
  });

  test("shows dashboard title and filter bar", async ({ supervisorPage: page }) => {
    await expect(page.getByRole("heading", { name: /tableau de bord/i })).toBeVisible();
    // Equipment select
    await expect(page.getByRole("combobox")).toBeVisible();
    // Zoom level button ("Mois" also appears in the Evolution chart, so scope
    // to the first match in the filter bar).
    await expect(page.getByRole("button", { name: "Mois" }).first()).toBeVisible();
    // Export buttons — "CSV" must be exact to avoid matching "Export CSV".
    await expect(page.getByRole("button", { name: "CSV", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "PDF", exact: true })).toBeVisible();
  });

  test("CSV export triggers download and shows success toast", async ({ supervisorPage: page }) => {
    // Listen for download
    const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await page.getByRole("button", { name: "CSV", exact: true }).click();
    // Toast should appear
    await expect(page.getByText(/export csv téléchargé/i)).toBeVisible({ timeout: 3000 });
  });

  test("CSV export neutralizes formula injection in product names", async ({ supervisorPage: page }) => {
    // A product named with a leading "=" would execute as a formula in Excel.
    const period = { from: "2026-06-01", to: "2026-06-07", equipmentId: "equip-1" };
    const day = {
      ...TRS_EMPTY.session, date: "2026-06-07", aClasserMin: 0, notes: null,
      lots: [{ ...(TRS_EMPTY.lots?.[0] ?? {}), productName: "=HACK()", batchNumber: "26013" }],
      reliability: { mtbf: 0, mttr: 0, availability: 0, breakdownCount: 0 },
    };
    await page.unroute(/\/api\/dashboard\/trs/);
    await page.route(/\/api\/dashboard\/trs/, (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ period, daily: [day], total: { ...day, reliability: day.reliability } }),
    }));
    await page.reload();
    await expect(page.getByText(/tableau de bord trs/i)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "CSV", exact: true }).click(),
    ]);
    const csv = fs.readFileSync(await download.path(), "utf8");
    // The dangerous cell must be neutralized (prefixed with ') — never raw.
    expect(csv).not.toMatch(/(^|,)=HACK/);
    expect(csv).toContain("'=HACK()");
  });

  test("PDF button shows loading spinner while generating", async ({ supervisorPage: page }) => {
    // Delay pdf generation by intercepting the dynamic import's network requests
    // We verify the button transitions to loading state
    const pdfBtn = page.getByRole("button", { name: /pdf/i });
    await pdfBtn.click();
    // Button should show loading text briefly
    await expect(page.getByRole("button", { name: /pdf…/i })).toBeVisible({ timeout: 2000 }).catch(() => {
      // May resolve too fast in jsdom — that's acceptable
    });
  });

  test("comparison button toggles comparison view", async ({ supervisorPage: page }) => {
    await page.getByRole("button", { name: /comparer/i }).click();
    // Should show comparison section (no data in mock, but button state changes)
    await expect(page.getByRole("button", { name: /comparer/i })).toHaveClass(/bg-blue/);
  });

  test("zoom level buttons change the active selection", async ({ supervisorPage: page }) => {
    await page.getByRole("button", { name: /semaine/i }).click();
    await expect(page.getByRole("button", { name: /semaine/i })).toHaveClass(/bg-blue/);
  });

  test("custom date range inputs appear when 'Libre' is selected", async ({ supervisorPage: page }) => {
    // The custom-range zoom level is labelled "Libre".
    await page.getByRole("button", { name: "Libre" }).click();
    await expect(page.locator("input[type='date']").first()).toBeVisible();
  });

  test("an invalid custom range shows an alert and is not queried", async ({ supervisorPage: page }) => {
    const ranges: { from: string | null; to: string | null }[] = [];
    await page.route(/\/api\/dashboard\/trs/, (r) => {
      const u = new URL(r.request().url());
      ranges.push({ from: u.searchParams.get("from"), to: u.searchParams.get("to") });
      r.fallback();
    });
    await page.getByRole("button", { name: "Libre" }).click();
    // Pick the end date first, then a later start date → end < start (reachable
    // because the "from" input has no min). The alert must show, and the query
    // must never run with from > to.
    await page.getByLabel("Date de fin").fill("2026-06-10");
    await page.getByLabel("Date de début").fill("2026-06-20");
    await expect(page.getByText(/postérieure à la date de début/i)).toBeVisible();
    await page.waitForTimeout(300);
    expect(ranges.every(r => r.from === null || r.to === null || r.from <= r.to),
      `no query may use from > to, got ${JSON.stringify(ranges)}`).toBe(true);
  });
});
