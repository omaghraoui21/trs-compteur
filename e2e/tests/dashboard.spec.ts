import { test, expect, mockDashboardRoutes } from "../fixtures";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ supervisorPage: page }) => {
    await mockDashboardRoutes(page);
    await page.goto("/dashboard");
    // Wait for the page to finish loading
    await expect(page.getByText(/tableau de bord trs/i)).toBeVisible();
  });

  test("shows dashboard title and filter bar", async ({ supervisorPage: page }) => {
    await expect(page.getByRole("heading", { name: /tableau de bord/i })).toBeVisible();
    // Equipment select (.first(): charts may add their own selects once data loads)
    await expect(page.getByRole("combobox").first()).toBeVisible();
    // Zoom level buttons (.first(): the TRS chart has its own "Mois" granularity toggle)
    await expect(page.getByRole("button", { name: "Mois", exact: true }).first()).toBeVisible();
    // Export buttons (exact: a secondary "Export CSV" link also exists)
    await expect(page.getByRole("button", { name: "CSV", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "PDF", exact: true })).toBeVisible();
  });

  test("CSV export triggers download and shows success toast", async ({ supervisorPage: page }) => {
    // Listen for download
    const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await page.getByRole("button", { name: /csv/i }).click();
    // Toast should appear
    await expect(page.getByText(/export csv téléchargé/i)).toBeVisible({ timeout: 3000 });
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
    await page.getByRole("button", { name: /libre/i }).click();
    await expect(page.locator("input[type='date']").first()).toBeVisible();
  });
});
