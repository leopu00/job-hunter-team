import { expect, test } from "@playwright/test";

test("la home accompagna da Come si avvia al download Desktop-first", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const start = page.locator('#cta a[href="/run"]');
  await expect(start).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(/\/run$/);

  const install = page.locator('main a[href="/download"]').first();
  await expect(install).toBeVisible();
  await install.click();
  await expect(page).toHaveURL(/\/download$/);

  const modes = page.locator("[data-install-mode]");
  await expect(modes).toHaveCount(2);
  await expect(modes.nth(0)).toHaveAttribute("data-install-mode", "desktop");
  await expect(modes.nth(0)).toHaveAttribute("data-active", "true");
  await expect(modes.nth(1)).toHaveAttribute("data-install-mode", "terminal");
});
