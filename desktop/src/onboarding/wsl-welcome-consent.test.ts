import { describe, expect, it } from "vitest";
import { COMPUTER_TEXT } from "../pages/computer/computer.i18n";
import { ONBOARDING_TEXT, type WindowsSetup } from "./onboarding.i18n";

// The Windows setup marks WSL's welcome as already seen for the user (OOBEComplete in HKCU's Lxss
// key), so its window does not open over the app: a change to a Windows setting of the user's,
// said in the consent before it happens and, where removal is explained, what stays and how to
// undo it.
const SETUP: WindowsSetup = { podmanVersion: "6.0.2", composeVersion: "5.1.2", cpus: 2, memoryGb: 3, diskGb: 30 };
const KEY = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss";

describe("WSL's welcome marked as seen, in the open", () => {
  it.each(Object.keys(ONBOARDING_TEXT))("%s: the consent says it before the setup", (locale) => {
    const installs = ONBOARDING_TEXT[locale as keyof typeof ONBOARDING_TEXT].installs(SETUP);
    expect(installs.filter((line) => line.includes("OOBEComplete") && line.includes("WSL")), locale).toHaveLength(1);
  });

  it.each(Object.keys(COMPUTER_TEXT))("%s: removing JHT says the value stays, where it is and how to delete it", (locale) => {
    const keeps = COMPUTER_TEXT[locale as keyof typeof COMPUTER_TEXT].keeps;
    const line = keeps.find((entry) => entry.includes("OOBEComplete"));
    expect(line, locale).toBeDefined();
    expect(line).toContain(KEY);
  });
});
