import { test, expect, SESSION, SESSION_DETAIL_EMPTY, LOT_ACTIVE, LOT_CLOSED, TRS_WITH_LOT } from "../fixtures";

// ─── Full operator workflow ───────────────────────────────────────────────────
// Covers: room pick → equipment pick → open session → start lot →
//          declare downtime → close lot → close session

test.describe("Operator — session lifecycle", () => {
  test("shows room picker on /compteur", async ({ operatorPage: page }) => {
    await page.goto("/compteur");
    await expect(page.getByText("Choisir le local")).toBeVisible();
    await expect(page.getByText("Salle de Production")).toBeVisible();
  });

  test("picks room → shows equipment list", async ({ operatorPage: page }) => {
    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await expect(page.getByText("Blistereuse IMA TR135S")).toBeVisible();
  });

  test("picks equipment → no active session → shows open button", async ({ operatorPage: page }) => {
    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await expect(page.getByRole("button", { name: /ouvrir le compteur/i })).toBeVisible();
  });

  test("opens a session → shows timeline view", async ({ operatorPage: page }) => {
    // After opening, detail + TRS are fetched
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }),
    );

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();

    // Should now see the session timeline
    await expect(page.getByRole("button", { name: /nouveau lot/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /déclarer un arrêt/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /fermer/i })).toBeVisible();
  });

  test("shows new-lot form when clicking 'Nouveau lot'", async ({ operatorPage: page }) => {
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }),
    );

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();
    await page.getByRole("button", { name: /nouveau lot/i }).click();

    // The new-lot form uses a "Produit" select, an "N° de lot" field and a
    // "Cadence" field, submitted via "Démarrer le lot".
    await expect(page.getByRole("heading", { name: /nouveau lot/i })).toBeVisible();
    await expect(page.getByLabel("N° de lot")).toBeVisible();
    await expect(page.getByLabel("Cadence")).toBeVisible();
  });

  test("submits new-lot form → lot appears in timeline", async ({ operatorPage: page }) => {
    // After lot is started, session detail now includes the active lot
    let sessionCallCount = 0;
    await page.route(/\/api\/sessions\/session-1$/, (r) => {
      sessionCallCount++;
      const detail = sessionCallCount > 1
        ? { ...SESSION_DETAIL_EMPTY, lots: [LOT_ACTIVE] }
        : SESSION_DETAIL_EMPTY;
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
    });

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();
    await page.getByRole("button", { name: /nouveau lot/i }).click();

    // Select product (the form uses a native <select> combobox)
    await page.getByLabel("Produit").selectOption({ label: "Aeronide 200µg" });
    // Fill batch number
    await page.getByPlaceholder(/26\d{3}|numéro.*lot|batch/i).fill("26013");
    // Submit
    await page.getByRole("button", { name: /démarrer le lot/i }).click();
    // The first lot of a session shows a confirmation step before the POST;
    // confirm it ("Démarrer", exact so it doesn't match "Démarrer le lot").
    await page.getByRole("button", { name: "Démarrer", exact: true }).click();

    // Lot number or batch should appear in the timeline table.
    // The batch number also renders in the active-lot card title/heading,
    // so scope the assertion to the timeline cell to avoid a strict-mode clash.
    await expect(page.getByRole("cell", { name: "26013" })).toBeVisible();
  });

  test("declare downtime form shows categories", async ({ operatorPage: page }) => {
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ...SESSION_DETAIL_EMPTY, lots: [LOT_ACTIVE],
      }) }),
    );

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();
    await page.getByRole("button", { name: /déclarer un arrêt/i }).click();

    await expect(page.getByText("Panne machine")).toBeVisible();
  });

  test("submitting an inter-lot downtime posts it and returns to the timeline", async ({ operatorPage: page }) => {
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }),
    );
    let posted: any = null;
    await page.route(/\/api\/sessions\/session-1\/downtimes/, (r) => {
      posted = JSON.parse(r.request().postData() || "{}");
      r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "dt-x" }) });
    });

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();
    await page.getByRole("button", { name: /déclarer un arrêt/i }).click();

    // Select category + a duration preset, then submit.
    await page.getByRole("button", { name: /panne machine/i }).first().click();
    await page.getByRole("button", { name: "15", exact: true }).click();
    await page.getByRole("button", { name: /enregistrer l'arrêt/i }).click();

    // Returns to the timeline (the action buttons are visible again).
    await expect(page.getByRole("button", { name: /nouveau lot/i })).toBeVisible();
    expect(posted, "downtime payload").toMatchObject({ categoryId: "cat-1", durationMinutes: 15 });
  });

  test("end-of-shift modal appears on 'Fermer'", async ({ operatorPage: page }) => {
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }),
    );

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();
    await page.getByRole("button", { name: /fermer la session/i }).click();

    await expect(page.getByText(/fermer le compteur/i)).toBeVisible();
    await expect(page.getByText(/annuler/i)).toBeVisible();
  });

  test("EndOfShiftModal shows checklist items", async ({ operatorPage: page }) => {
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }),
    );

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();
    await page.getByRole("button", { name: /fermer la session/i }).click();

    // Checklist should show "tous les lots sont clôturés"
    await expect(page.getByText(/tous les lots sont clôturés/i)).toBeVisible();
    // And "temps de session classé"
    await expect(page.getByText(/temps de session classé/i)).toBeVisible();
  });

  test("confirms session close → navigates back to room picker", async ({ operatorPage: page }) => {
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }),
    );

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();
    await page.getByRole("button", { name: /fermer la session/i }).click();

    // Confirm close in modal
    await page.getByRole("button", { name: /^fermer$/i }).last().click();

    // Should navigate back to room picker
    await expect(page.getByText("Choisir le local")).toBeVisible({ timeout: 5000 });
  });
});

// ─── "À classer" banner ───────────────────────────────────────────────────────

test.describe("Unclassified time banner", () => {
  test("shows amber banner when aClasserMin is 5-9", async ({ operatorPage: page }) => {
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }),
    );
    await page.route(/\/api\/sessions\/session-1\/trs/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ...TRS_WITH_LOT, aClasserMin: 7,
      }) }),
    );

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();

    await expect(page.getByText(/de temps non classé/i)).toBeVisible();
  });

  test("blocks session close when aClasserMin >= 10", async ({ operatorPage: page }) => {
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }),
    );
    await page.route(/\/api\/sessions\/session-1\/trs/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ...TRS_WITH_LOT, aClasserMin: 15,
      }) }),
    );

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();
    await page.getByRole("button", { name: /fermer la session/i }).click();

    // The close button inside the modal should be disabled…
    const confirmBtn = page.getByRole("button", { name: /^fermer$/i }).last();
    await expect(confirmBtn).toBeDisabled();
    // …and explain why (accessible reason + visible blocking message).
    await expect(page.locator("#eos-blocked-reason")).toBeVisible();
    await expect(confirmBtn).toHaveAttribute("aria-describedby", "eos-blocked-reason");
  });
});

// ─── Session badge in nav ─────────────────────────────────────────────────────

test.describe("Session badge", () => {
  test("shows equipment name in header badge when session is open", async ({ operatorPage: page }) => {
    await page.route(/\/api\/sessions\/session-1$/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL_EMPTY) }),
    );

    await page.goto("/compteur");
    await page.getByText("Salle de Production").click();
    await page.getByText("Blistereuse IMA TR135S").click();
    await page.getByRole("button", { name: /ouvrir le compteur/i }).click();

    // Badge showing equipment name should appear in the header
    await expect(page.getByText(/blistereuse ima tr135s/i).first()).toBeVisible();
  });
});
