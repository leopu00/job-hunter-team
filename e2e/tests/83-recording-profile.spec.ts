import { expect, test } from "@playwright/test";

/**
 * REL-004 — gate dei profili usati per le riprese pubbliche.
 *
 * Richiede uno storage state privato generato da `npm run recording-profile`.
 * Non usa né crea account in CI: senza l'opt-in esplicito si skippera con il
 * motivo, perché token e credenziali non devono entrare nel repository.
 */
test.describe("profilo riprese autenticato", () => {
  test("usa dati reali, tema light e nessun segnale demo", async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(
      !process.env.JHT_RECORDING_PROFILE,
      "richiede JHT_RECORDING_PROFILE + E2E_STORAGE_STATE privato",
    );

    // Pre-ciak: rende innocuo anche un browser riusato che avesse conservato
    // un cookie demo. Il reload successivo e' il primo frame registrabile.
    const initialResponse = await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
    });
    expect(initialResponse?.status()).toBe(200);
    const clearDemo = await page.request.delete("/api/demo");
    expect(clearDemo.ok(), "pre-ciak DELETE /api/demo fallita").toBe(true);
    const response = await page.reload({ waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard$/);

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
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name === "jht_demo_persona",
      ),
      "cookie jht_demo_persona presente dopo il pre-ciak",
    ).toBe(false);

    const assertRecordingFrame = async () => {
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("jht-theme")), {
          message: "storage del profilo riprese non forza il tema light",
        })
        .toBe("light");
      await expect(
        page.locator('[aria-busy="true"]:visible'),
        "loader visibile: il frame non e' ancora registrabile",
      ).toHaveCount(0, { timeout: 15_000 });
      const frame = await page.evaluate(() => ({
        renderedTheme: document.documentElement.getAttribute("data-theme"),
        text: document.body.innerText,
        buttons: Array.from(document.querySelectorAll("button"), (button) =>
          (button.textContent ?? "").trim(),
        ),
      }));
      expect(frame.renderedTheme, "tema renderizzato non light").toBe("light");

      for (const forbiddenText of [
        /modalità demo|demo mode|modo demo|mode démo|demo-modus|demó mód/i,
        /you are looking at sample data/i,
        /connect your team/i,
        /exit demo/i,
      ]) {
        expect(
          frame.text,
          `segnale demo visibile: ${forbiddenText.source}`,
        ).not.toMatch(forbiddenText);
      }
      for (const forbiddenAction of [/connect your team/i, /exit demo/i]) {
        expect(
          frame.buttons.some((label) => forbiddenAction.test(label)),
          `azione demo visibile: ${forbiddenAction.source}`,
        ).toBe(false);
      }
    };
    await assertRecordingFrame();

    const positionLinks = page.locator('a[href^="/positions/"]');
    await expect(
      page.locator('a[href^="/positions/"]:visible').first(),
      "anchor posizione non visibile: il frame non e' registrabile",
    ).toBeVisible({ timeout: 15_000 });
    const hrefs = await positionLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    );
    for (const href of hrefs) {
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
    await assertRecordingFrame();
  });
});
