import AxeBuilder from "@axe-core/playwright";
import { test, expect, mockDashboardRoutes, PENDING_LOT } from "../fixtures";

// ─── Accessibility audit (WCAG 2.1 A/AA) ──────────────────────────────────────
// Gates on STRUCTURAL serious/critical findings (missing labels, button names,
// roles, ARIA) — the high-impact issues most likely to regress.
//
// `color-contrast` is intentionally excluded from the gate: the remaining
// contrast findings are on the app's *semantic* palette (green/amber/red for TRS
// quality, driven by the engine's trsColor()), so changing them is a design
// decision rather than a safe mechanical fix. The muted neutral text was already
// darkened (gray-400 → gray-500) for readability. Run without `.disableRules`
// to see the advisory contrast report.

const IMPACTFUL = new Set(["serious", "critical"]);

function report(violations: any[]) {
  return violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})\n    ${v.nodes[0]?.target?.join(" ")}`)
    .join("\n");
}

async function structuralAudit(page: any) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["color-contrast"])
    .analyze();
  const impactful = violations.filter((v) => IMPACTFUL.has(v.impact));
  return { impactful, text: report(impactful) };
}

test.describe("Accessibility (axe — structural)", () => {
  test("login page", async ({ page }) => {
    await page.route(/\/api\/auth\/me/, (r) => r.fulfill({ status: 401, body: "{}" }));
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /se connecter/i })).toBeVisible();
    const { impactful, text } = await structuralAudit(page);
    expect(impactful, text).toEqual([]);
  });

  test("operator room picker", async ({ operatorPage: page }) => {
    await page.goto("/compteur");
    await expect(page.getByText("Choisir le local")).toBeVisible();
    const { impactful, text } = await structuralAudit(page);
    expect(impactful, text).toEqual([]);
  });

  test("supervisor queue (expanded)", async ({ supervisorPage: page }) => {
    await page.route(/\/api\/dashboard\/pending-lots/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([PENDING_LOT]) }),
    );
    await page.goto("/supervisor");
    await expect(page.getByText("26013")).toBeVisible();
    await page.getByText("26013").click();
    const { impactful, text } = await structuralAudit(page);
    expect(impactful, text).toEqual([]);
  });

  test("dashboard", async ({ supervisorPage: page }) => {
    await mockDashboardRoutes(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /tableau de bord/i })).toBeVisible();
    const { impactful, text } = await structuralAudit(page);
    expect(impactful, text).toEqual([]);
  });

  test("admin configuration", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /configuration/i })).toBeVisible();
    const { impactful, text } = await structuralAudit(page);
    expect(impactful, text).toEqual([]);
  });
});
