import { test as base, expect, type Page } from "@playwright/test";
import {
  OPERATOR_USER, SUPERVISOR_USER,
  ROOM, EQUIPMENT, PRODUCT, CADENCE, DOWNTIME_CATEGORY,
  SESSION, SESSION_DETAIL_EMPTY, LOT_ACTIVE, LOT_CLOSED,
  DOWNTIME_EVENT, TRS_EMPTY, PENDING_LOT,
} from "./data";

export { expect };
export * from "./data";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Pre-populate localStorage so the app starts in an authenticated state. */
async function injectTokens(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("trs_token", "fake-access-token");
    localStorage.setItem("trs_refresh", "fake-refresh-token");
    // Suppress the first-run onboarding overlay — it covers the operator view
    // and intercepts pointer events, breaking every interaction-based test.
    localStorage.setItem("trs_onboarding_done", "1");
  });
}

// ─── Route helpers ───────────────────────────────────────────────────────────

function json(page: Page, pattern: string | RegExp, body: unknown, status = 200) {
  return page.route(pattern, (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

/** Intercept a method + pattern, return body once, then fall through. */
function jsonOnce(page: Page, pattern: string | RegExp, body: unknown, status = 200) {
  return page.route(pattern, (route, request) => {
    page.unroute(pattern);
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
}

// ─── Shared route registrations ──────────────────────────────────────────────

export async function mockAuthRoutes(page: Page, user = OPERATOR_USER) {
  await json(page, /\/api\/auth\/me/, user);
  await page.route(/\/api\/auth\/logout/, (r) => r.fulfill({ status: 200, body: "{}" }));
}

export async function mockRefRoutes(page: Page) {
  await json(page, /\/api\/ref\/rooms$/, [ROOM]);
  await json(page, /\/api\/ref\/rooms\/[^/]+\/equipments/, [EQUIPMENT]);
  await json(page, /\/api\/ref\/equipments/, [EQUIPMENT]);
  await json(page, /\/api\/ref\/products/, [PRODUCT]);
  await json(page, /\/api\/ref\/downtime-categories/, [DOWNTIME_CATEGORY]);
  await json(page, /\/api\/ref\/cadences/, [CADENCE]);
}

export async function mockSessionRoutes(page: Page) {
  // GET /api/sessions — no active session initially
  await json(page, /\/api\/sessions\?/, []);
  // GET /api/sessions/:id — detail
  await json(page, /\/api\/sessions\/session-1$/, SESSION_DETAIL_EMPTY);
  // GET /api/sessions/:id/trs
  await json(page, /\/api\/sessions\/session-1\/trs/, TRS_EMPTY);
  // POST /api/sessions/open
  await page.route(/\/api\/sessions\/open/, (r) =>
    r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(SESSION) }),
  );
  // POST /api/sessions/:id/close
  await page.route(/\/api\/sessions\/session-1\/close/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...SESSION, status: "closed", closedAt: new Date().toISOString() }) }),
  );
  // POST /api/sessions/:id/downtimes
  await page.route(/\/api\/sessions\/session-1\/downtimes/, (r) =>
    r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(DOWNTIME_EVENT) }),
  );
}

export async function mockLotRoutes(page: Page) {
  // POST /api/lots — start lot
  await page.route(/\/api\/lots$/, (r) =>
    r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(LOT_ACTIVE) }),
  );
  // POST /api/lots/:id/close
  await page.route(/\/api\/lots\/lot-1\/close/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LOT_CLOSED) }),
  );
  // POST /api/lots/:id/downtimes
  await page.route(/\/api\/lots\/lot-1\/downtimes/, (r) =>
    r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(DOWNTIME_EVENT) }),
  );
  // GET /api/lots/:id/downtimes
  await json(page, /\/api\/lots\/lot-1\/downtimes/, [DOWNTIME_EVENT]);
  // GET /api/lots/:id/cadence
  await json(page, /\/api\/lots\/lot-1\/cadence/, []);
}

export async function mockDashboardRoutes(page: Page) {
  const period = { from: "2026-06-01", to: "2026-06-07", equipmentId: "equip-1" };
  const daily = [{ ...TRS_EMPTY.session, date: "2026-06-07", lots: [], notes: null }];
  const zoom = { ...TRS_EMPTY.session };
  await json(page, /\/api\/dashboard\/trs/, { period, daily, total: { ...zoom, reliability: { mtbf: 0, mttr: 0, availability: 0, failureCount: 0 } } });
  await json(page, /\/api\/dashboard\/pareto/, { pareto: [], totalMin: 0 });
  await json(page, /\/api\/dashboard\/comparison/, { period, equipments: [] });
  await json(page, /\/api\/dashboard\/by-product/, { period, periodTR: 0, periodTRS: 0, byProduct: [] });
  await json(page, /\/api\/dashboard\/six-losses/, { period, total: { losses: [] }, daily: [] });
  await json(page, /\/api\/dashboard\/heatmap/, { period, heatmap: [] });
  await json(page, /\/api\/dashboard\/downtime-log/, { period, log: [] });
  await json(page, /\/api\/dashboard\/pending-lots/, [PENDING_LOT]);
  await json(page, /\/api\/ref\/equipments/, [EQUIPMENT]);
}

// ─── Custom test fixture ──────────────────────────────────────────────────────

type Fixtures = {
  /** Page with operator auth + all common routes mocked. */
  operatorPage: Page;
  /** Page with supervisor auth + all common routes mocked. */
  supervisorPage: Page;
};

export const test = base.extend<Fixtures>({
  operatorPage: async ({ page }, use) => {
    await injectTokens(page);
    await mockAuthRoutes(page, OPERATOR_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);
    await use(page);
  },

  supervisorPage: async ({ page }, use) => {
    await injectTokens(page);
    await mockAuthRoutes(page, SUPERVISOR_USER);
    await mockRefRoutes(page);
    await mockSessionRoutes(page);
    await mockLotRoutes(page);
    await mockDashboardRoutes(page);
    await use(page);
  },
});
