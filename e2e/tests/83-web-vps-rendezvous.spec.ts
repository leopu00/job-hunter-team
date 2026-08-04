import { expect, test, type Page } from "@playwright/test";

/**
 * Regressione browser del rendezvous web <-> VPS.
 *
 * I payload sono interamente sintetici: il browser prova la macchina a stati
 * del client, mentre l'integration test del worker prova import, pane e ACK.
 * Serve una sessione per renderizzare le pagine protette; senza, lo skip
 * dichiara esattamente il requisito ambientale.
 */

async function protectedSessionOrSkip(page: Page, path: string) {
  const response = await page.request.get(path, { maxRedirects: 0 });
  test.skip(
    response.status() === 307,
    "serve una sessione autenticata per l'area riservata — vedi e2e/README.md § Sessione",
  );
}

test.describe("rendezvous web-VPS", () => {
  test("Sync now osserva il completamento senza Realtime e senza reload", async ({
    page,
    baseURL,
  }) => {
    // L'account E2E non ha dati e verrebbe mandato al wizard: qui si prova
    // la dashboard, quindi dichiariamo il wizard gia' visto nel solo context.
    await page.context().addCookies([
      { name: "jht_welcome_seen", value: "1", url: baseURL! },
    ]);
    await protectedSessionOrSkip(page, "/dashboard");

    const baseline = "2026-08-04T12:00:00.000Z";
    const requestedAt = "2026-08-04T12:00:01.000Z";
    const completedAt = "2026-08-04T12:00:06.000Z";
    let statusReads = 0;
    let requestOpened = false;
    let allowCompletion = false;

    await page.route("**/api/local/sync/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ remote: true, logged_in: true }),
      }),
    );
    await page.route("**/api/team-state", async (route) => {
      if (route.request().method() === "PATCH") {
        requestOpened = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: {
              sync_requested_at: requestedAt,
              sync_completed_at: baseline,
            },
          }),
        });
      }
      if (requestOpened) statusReads += 1;
      const completed = requestOpened && allowCompletion;
      const observedCompletion = completed ? completedAt : baseline;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: {
            sync_completed_at: observedCompletion,
            last_action: completed ? "sync:completed" : null,
            last_action_at: completed
              ? "2026-08-04T12:00:06.001Z"
              : null,
          },
        }),
      });
    });

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    // Il nome accessibile cambia da "Sync now" a "Sync…" durante il giro.
    const button = page.getByRole("button", { name: /Sync/ }).first();
    await expect(button).toBeVisible();
    await button.click();
    await expect(button).toBeDisabled();
    allowCompletion = true;
    await expect(button).toBeEnabled({ timeout: 5_000 });
    await expect.poll(() => statusReads).toBeGreaterThan(0);

    // router.refresh aggiorna i dati RSC, ma il documento non viene ricaricato.
    expect(
      await page.evaluate(
        () => performance.getEntriesByType("navigation").length,
      ),
    ).toBe(1);
  });

  test("un bell chat fallito viene ritentato senza duplicare il messaggio", async ({
    page,
  }) => {
    await protectedSessionOrSkip(page, "/messages");

    const fixtureBody = "E2E synthetic rendezvous message";
    let inserts = 0;
    let signalRetries = 0;

    await page.route("**/api/pending-messages", (route) => {
      if (route.request().method() !== "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ messages: [], unread: 0 }),
        });
      }
      inserts += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          signalled: false,
          message: {
            id: "fixture-chat-rendezvous",
            agent: "assistente",
            body: fixtureBody,
            kind: "notification",
            author: "user",
            related_position_id: null,
            delivered_via: "web",
            delivered_at: null,
            acknowledged_at: "2026-08-04T12:00:00.000Z",
            user_reply: null,
            user_reply_at: null,
            agent_seen_reply_at: null,
            created_at: "2026-08-04T12:00:00.000Z",
          },
        }),
      });
    });
    await page.route("**/api/team-state", (route) => {
      if (route.request().method() === "PATCH") signalRetries += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ state: {} }),
      });
    });

    await page.goto("/messages", { waitUntil: "domcontentloaded" });
    const composer = page.locator("textarea").last();
    await expect(composer).toBeVisible();
    await composer.fill(fixtureBody);
    await composer.press("Enter");

    await expect(page.getByText(fixtureBody, { exact: true })).toHaveCount(1);
    await expect.poll(() => inserts).toBe(1);
    await expect.poll(() => signalRetries).toBe(1);
    expect(
      await page.evaluate(
        () => performance.getEntriesByType("navigation").length,
      ),
    ).toBe(1);
  });
});
