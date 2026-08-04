import { expect, test } from "@playwright/test";

/**
 * REL-004 — gate dei profili usati per le riprese pubbliche.
 *
 * Richiede uno storage state privato generato da `npm run recording-profile`.
 * Non usa né crea account in CI: senza l'opt-in esplicito si skippera con il
 * motivo, perché token e credenziali non devono entrare nel repository.
 */
test.describe("profilo riprese autenticato", () => {
  test("usa dati reali dell'account e non mostra segnali demo", async ({
    page,
  }) => {
    test.skip(
      !process.env.JHT_RECORDING_PROFILE,
      "richiede JHT_RECORDING_PROFILE + E2E_STORAGE_STATE privato",
    );

    const state = await page.request.get("/api/demo");
    expect(state.ok()).toBe(true);
    const body = (await state.json()) as {
      persona: string | null;
      synced: boolean;
    };
    expect(body.persona, "cookie demo attivo sul profilo riprese").toBeNull();
    expect(body.synced, "il profilo non espone righe reali sincronizzate").toBe(
      true,
    );

    const response = await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard$/);

    const demoBanner = page.getByText(
      /modalità demo|demo mode|modo demo|mode démo|demo-modus|demó mód/i,
    );
    await expect(demoBanner, "banner demo visibile").toHaveCount(0);

    const positionLinks = page.locator('a[href^="/positions/"]');
    await expect
      .poll(() => positionLinks.count(), {
        message: "dashboard senza posizioni materializzate",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    for (const link of await positionLinks.all()) {
      const href = (await link.getAttribute("href")) ?? "";
      expect(href, "id demo trasferito invece di UUID reale").not.toContain(
        "/positions/demo-",
      );
    }

    const messagesResponse = await page.goto("/messages", {
      waitUntil: "domcontentloaded",
    });
    expect(messagesResponse?.status()).toBe(200);
    for (const [agent, text] of [
      ["Assistant", "Help me organize the next steps for this week."],
      ["Mentor", "What pattern should I watch for before I apply?"],
      ["Captain", "What should the team focus on today?"],
    ] as const) {
      await page.getByRole("button", { name: agent, exact: true }).click();
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    }
    await expect(demoBanner, "banner demo visibile nella chat").toHaveCount(0);
  });
});
