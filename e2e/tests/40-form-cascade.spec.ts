import { test, expect } from "@playwright/test";

/**
 * FLUSSO 40 — una classe scritta su un campo vince davvero
 *
 * O-78. `globals.css` dà a `input, textarea, select` i loro valori di
 * partenza (font 13px, padding 8/12, sfondo, bordo, raggio). Finché quelle
 * regole sono state FUORI da ogni `@layer`, hanno battuto ogni utility
 * Tailwind: chi scriveva `text-sm` o `px-3` su un campo non otteneva niente,
 * senza nessun errore che glielo dicesse. Il difetto si vedeva sul campo di
 * ricerca di /positions (44px dentro un contenitore da 37, fuori dal proprio
 * bordo), ma il costo vero era per chiunque avrebbe scritto una classe dopo.
 *
 * `tests/js/tasks/globals-form-layer.test.ts` tiene ferma la struttura del
 * CSS: le regole stanno in `@layer base`. Quel test però legge un file — non
 * prova che nel BROWSER la cascata si comporti di conseguenza. Questa spec sì,
 * e lo fa su una pagina pubblica (`/contact`, nessuna sessione richiesta),
 * quindi gira nella CI pubblica come le altre 8x.
 *
 * I valori attesi vengono dalle classi che quei campi già dichiarano
 * (`ContactForm.tsx`: `px-3 py-2.5 text-sm`) e dal default che NON
 * dichiarano — il raggio. Se qualcuno riportasse le regole fuori dal layer,
 * font e padding tornerebbero 13px e 8px e questa spec diventerebbe rossa.
 */
test.describe("cascata dei campi — le utility battono i default", () => {
  test("su /contact la classe vince, e il default resta dove non c'è classe", async ({
    page,
  }) => {
    const res = await page.goto("/contact", { waitUntil: "domcontentloaded" });
    expect(res?.status(), "/contact non risponde 200").toBe(200);

    const message = page.locator("form textarea").first();
    await expect(message, "il modulo di contatto non c'è").toBeVisible({
      timeout: 15_000,
    });

    const style = await message.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        font: s.fontSize,
        padTop: s.paddingTop,
        padLeft: s.paddingLeft,
        radius: s.borderTopLeftRadius,
      };
    });

    // `text-sm` e `px-3 py-2.5` sono scritte sul campo: devono vincere sui
    // 13px / 8px / 12px del default. Sono anche i valori che il difetto
    // rendeva irraggiungibili.
    expect(
      style.font,
      "la classe text-sm non vince sul default dell'elemento: le regole dei campi sono tornate fuori da @layer",
    ).toBe("14px");
    expect(style.padTop, "py-2.5 ignorato").toBe("10px");
    expect(style.padLeft, "px-3 ignorato").toBe("12px");

    // E dove nessuna classe parla, il default deve restare: il modulo non
    // dichiara un raggio, quindi vale quello di globals.css. Se sparisse,
    // «layerizzare» avrebbe voluto dire «disattivare».
    expect(
      style.radius,
      "il default dell'elemento non si applica più: layerizzare non deve disattivare",
    ).toBe("4px");
  });
});
