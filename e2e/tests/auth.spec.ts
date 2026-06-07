import { test as base, expect } from "@playwright/test";

// Auth tests use the bare `test` (no pre-injected tokens).
const test = base;

test.beforeEach(async ({ page }) => {
  // Stub login endpoint
  await page.route(/\/api\/auth\/login/, async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    if (body.email === "operateur@dpi.local" && body.password === "oper123") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "valid-access-token",
          refreshToken: "valid-refresh-token",
          user: { id: "u1", email: "operateur@dpi.local", displayName: "Opérateur Test", role: "operator" },
        }),
      });
    } else {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Identifiants invalides" }),
      });
    }
  });

  // /api/auth/me will 401 because no token is set — app redirects to /login
  await page.route(/\/api\/auth\/me/, (r) => r.fulfill({ status: 401, body: "{}" }));
});

test("redirects unauthenticated users to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("shows login form with email and password fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/mot de passe/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /se connecter/i })).toBeVisible();
});

test("shows error message on invalid credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("wrong@example.com");
  await page.getByLabel(/mot de passe/i).fill("badpassword");
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByText(/identifiants invalides/i)).toBeVisible();
});

test("shows spinner while login request is in flight", async ({ page }) => {
  // Delay the response to observe the loading state
  await page.unroute(/\/api\/auth\/login/);
  await page.route(/\/api\/auth\/login/, async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Identifiants invalides" }),
    });
  });

  await page.goto("/login");
  await page.getByLabel(/email/i).fill("x@x.com");
  await page.getByLabel(/mot de passe/i).fill("wrong");
  await page.getByRole("button", { name: /se connecter/i }).click();

  // Button should be disabled and show loading text while in flight
  const btn = page.getByRole("button", { name: /connexion/i });
  await expect(btn).toBeDisabled();
});

test("stores tokens in localStorage after successful login", async ({ page }) => {
  // After login, me endpoint must succeed for AuthProvider to keep the user
  await page.unroute(/\/api\/auth\/me/);
  await page.route(/\/api\/auth\/me/, (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "u1", email: "operateur@dpi.local", displayName: "Opérateur Test", role: "operator" }),
    }),
  );

  await page.goto("/login");
  await page.getByLabel(/email/i).fill("operateur@dpi.local");
  await page.getByLabel(/mot de passe/i).fill("oper123");
  await page.getByRole("button", { name: /se connecter/i }).click();

  // Wait until URL changes (redirect after login)
  await expect(page).not.toHaveURL(/\/login/);

  const token = await page.evaluate(() => localStorage.getItem("trs_token"));
  expect(token).toBe("valid-access-token");
});
