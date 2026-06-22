import { chromium } from "@playwright/test";
import fs from "fs"; import path from "path";

const LABEL = process.argv[2] || "before";
const OUT = path.resolve(`/home/user/trs-compteur/qa-screenshots/${LABEL}`);
fs.mkdirSync(OUT, { recursive: true });
const WEB = "http://localhost:5173";
const API = "http://localhost:3001/api";

const CREDS = {
  operator:   { email: "operateur@dpi.local",  pw: "oper123" },
  supervisor: { email: "superviseur@dpi.local", pw: "super123" },
  admin:      { email: "admin@dpi.local",        pw: "admin123" },
};
const VIEWPORTS = { desktop: { width: 1366, height: 900 }, mobile: { width: 390, height: 844 } };

const TOK_FILE = "/tmp/qa-tokens.json";
async function getTokens(role) {
  const r = await fetch(API + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: CREDS[role].email, password: CREDS[role].pw }),
  });
  if (!r.ok) throw new Error("login failed " + role + " " + r.status);
  return r.json();
}
async function loadTokens() {
  if (fs.existsSync(TOK_FILE)) {
    const t = JSON.parse(fs.readFileSync(TOK_FILE, "utf8"));
    // access tokens valid 15 min; refetch if older than 10 min
    if (Date.now() - t._ts < 10 * 60 * 1000) return t;
  }
  const t = { operator: await getTokens("operator"), supervisor: await getTokens("supervisor"), admin: await getTokens("admin"), _ts: Date.now() };
  fs.writeFileSync(TOK_FILE, JSON.stringify(t));
  return t;
}

// Inject the access token then reload so AuthProvider reads it on a fresh mount,
// and wait for the authenticated nav to confirm we're not on the login screen.
async function auth(page, tokens, url = "/") {
  const inject = async () => {
    await page.evaluate((t) => {
      localStorage.clear();
      localStorage.setItem("trs_token", t.token);
      localStorage.setItem("trs_refresh", t.refreshToken);
      localStorage.setItem("trs_onboarding_done", "1");
    }, tokens);
  };
  await page.goto(WEB + url, { waitUntil: "domcontentloaded" });
  await inject();
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    if (await page.locator("#login-email").count() === 0) return; // authenticated
    await inject(); // landed on login (token race) — re-set same token and retry
  }
  console.log("  WARN: still on login after retries for", url);
}

async function shot(page, name, vp) {
  await page.screenshot({ path: path.join(OUT, `${name}__${vp}.png`), fullPage: true });
  console.log("  saved", `${name}__${vp}.png`);
}

async function run() {
  const tokens = await loadTokens();
  const browser = await chromium.launch();
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", e => console.log("  PAGEERROR", e.message));

    // Login screen (logged out)
    await page.goto(WEB + "/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.goto(WEB + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await shot(page, "01-login", vpName);

    // Operator — Compteur: room picker → equipment → live timeline
    await auth(page, tokens.operator, "/");
    await page.waitForTimeout(1500);
    await shot(page, "02-compteur-pickroom", vpName);
    try {
      await page.locator('button:has-text("Local Géluleuse")').first().click({ timeout: 3000 });
      await page.waitForTimeout(1200);
      await shot(page, "02b-compteur-pickequip", vpName);
      await page.locator('button:has-text("Modu-C"), button:has-text("Géluleuse")').first().click({ timeout: 3000 });
      await page.waitForTimeout(2500);
      await shot(page, "02c-compteur-active", vpName);
    } catch (e) { console.log("  (compteur drill)", e.message.split("\n")[0]); }

    // Supervisor — pending lots
    await auth(page, tokens.supervisor, "/supervisor");
    await page.waitForTimeout(1500);
    await shot(page, "03-supervisor", vpName);
    try {
      const card = page.locator('button:has-text("Lot GE2406-102")').first();
      await card.scrollIntoViewIfNeeded({ timeout: 3000 });
      await card.click({ timeout: 4000, force: true });
      await page.waitForTimeout(1500);
      await shot(page, "03b-supervisor-expanded", vpName);
    } catch (e) { console.log("  (no expand)", e.message.split("\n")[0]); }

    // Dashboard
    await page.goto(WEB + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await shot(page, "04-dashboard", vpName);

    // Admin — all tabs
    await auth(page, tokens.admin, "/admin");
    await page.waitForTimeout(1500);
    await shot(page, "05-admin-Locaux", vpName);
    for (const t of ["quipements","Produits","Cadences","Arrêts","Utilisateurs","Journal"]) {
      try {
        const btn = page.locator(`button:has-text("${t}")`).first();
        if (await btn.count()) { await btn.click({ timeout: 2000 }); await page.waitForTimeout(900); await shot(page, `05-admin-${t.replace(/[^a-zA-Z]/g,"")}`, vpName); }
      } catch {}
    }
    // Admin add form (open create modal on Produits)
    try {
      await page.locator(`button:has-text("Produits")`).first().click(); await page.waitForTimeout(500);
      await page.locator(`button:has-text("Ajouter")`).first().click({ timeout: 2000 }); await page.waitForTimeout(700);
      await shot(page, "05-admin-addform", vpName);
    } catch {}

    await ctx.close();
  }
  await browser.close();
  console.log("DONE", LABEL);
}
run().catch(e => { console.error(e); process.exit(1); });
