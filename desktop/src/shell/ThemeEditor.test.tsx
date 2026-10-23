import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemePicker from "./ThemePicker";
import { CUSTOM_STORAGE_KEY, THEMES, THEME_STORAGE_KEY, readStoredCustom } from "./theme";
import { PRESETS } from "./theme-presets";
import { STATUS_TOKENS, TOKEN_NAMES } from "./theme-custom";
import { readThemeFile, writeThemeFile } from "./theme-file";

const css = readFileSync(join(process.cwd(), "src/dashboard/dashboard.css"), "utf8").replace(/\r\n?/g, "\n");

function setLocale(locale: string) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/`;
}

beforeEach(() => {
  setLocale("it");
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-jht-theme");
  document.documentElement.removeAttribute("data-theme");
});
afterEach(cleanup);

async function openEditor(user = userEvent.setup()) {
  render(<ThemePicker />);
  await user.click(screen.getByRole("button", { name: /Cambia tema/ }));
  await user.click(screen.getByRole("menuitem", { name: "Personalizza…" }));
  return { user, dialog: screen.getByRole("dialog", { name: "Tema personale" }) };
}

const save = () => screen.getByRole("button", { name: "Salva" });
const textField = (name: string) => screen.getByRole("textbox", { name: `${name}: codice colore` });
async function type(user: ReturnType<typeof userEvent.setup>, name: string, value: string) {
  const field = textField(name);
  await user.clear(field);
  await user.type(field, value);
}

describe("the table the editor starts from", () => {
  it.each(THEMES)("repeats the real $value palette of dashboard.css, seeds and state colours", ({ value }) => {
    const body = css.match(new RegExp(`:root\\[data-jht-theme="${value}"\\]\\s*\\{([\\s\\S]*?)\\}`))![1];
    const of = (name: string) => body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))![1].toLowerCase();
    expect(PRESETS[value].seeds).toEqual({
      background: of("--color-void"),
      panel: of("--color-panel"),
      text: of("--color-base"),
      border: of("--color-border"),
      accent: of("--color-green"),
    });
    for (const name of STATUS_TOKENS) expect(PRESETS[value].status[name], name).toBe(of(name));
  });
});

// Each test types into real fields and the fix ones search the palette's lightness: beside the whole suite
// under load the default 5 s is not enough, so the bound is explicit for the whole group.
describe("the editor of the personal theme", { timeout: 60_000 }, () => {
  it("opens from the theme menu as a dialog with a name, puts the focus inside and gives it back on Escape", async () => {
    const { user, dialog } = await openEditor();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("combobox", { name: "Parti da" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Cambia tema/ })).toHaveFocus();
  });

  it("keeps the Tab inside the dialog, both ways", async () => {
    const { user, dialog } = await openEditor();
    const inside = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select, input')];
    inside[inside.length - 1].focus();
    await user.tab();
    expect(inside[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(inside[inside.length - 1]).toHaveFocus();
  });

  it("starts from the palette in force, with every colour readable and Save available", async () => {
    const { dialog } = await openEditor();
    expect(within(dialog).getByText("Tutti i colori sono leggibili.")).toBeVisible();
    expect(save()).toHaveAttribute("aria-disabled", "false");
    expect(textField("Sfondo")).toHaveValue(PRESETS.dark.seeds.background);
  });

  it("shows the preview with the palette being made on that box only, and the page changes only on Save", async () => {
    const { user } = await openEditor();
    await type(user, "Accento", "#ff00aa");
    const preview = screen.getByTestId("theme-preview");
    expect(preview.style.getPropertyValue("--color-green")).toBe("#ff00aa");
    expect(document.documentElement.style.getPropertyValue("--color-green")).toBe("");
    expect(document.documentElement.dataset.jhtTheme).not.toBe("custom");
    expect(localStorage.getItem(CUSTOM_STORAGE_KEY)).toBeNull();
  });

  it("says which pair fails and by how much, in a polite live region, and turns Save off, linked to the list", async () => {
    const { user, dialog } = await openEditor();
    await type(user, "Testo", "#303040");
    const live = dialog.querySelector('[aria-live="polite"]')!;
    const lines = within(live as HTMLElement).getAllByRole("listitem");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].textContent).toMatch(/Testo su .+: \d\.\d : 1, ne serve almeno 4\.5 : 1/);
    expect(save()).toHaveAttribute("aria-disabled", "true");
    expect(live.id).not.toBe("");
    expect(save().getAttribute("aria-describedby")).toBe(live.id);
    await user.click(save());
    expect(localStorage.getItem(CUSTOM_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("refuses a colour code that is not six digits, and says so to assistive technology", async () => {
    const { user } = await openEditor();
    await type(user, "Bordo", "#12");
    expect(textField("Bordo")).toHaveAttribute("aria-invalid", "true");
    expect(save()).toHaveAttribute("aria-disabled", "true");
    await type(user, "Bordo", PRESETS.dark.seeds.border);
    expect(textField("Bordo")).toHaveAttribute("aria-invalid", "false");
    expect(save()).toHaveAttribute("aria-disabled", "false");
  });

  it("offers a fix per line and one for everything; after it Save is available and the change is told", async () => {
    const { user, dialog } = await openEditor();
    await type(user, "Testo", "#303040");
    await user.click(within(dialog).getAllByRole("button", { name: /^Correggi: / })[0]);
    expect(dialog.querySelector(".theme-editor__note")!.textContent).toMatch(/^Testo: da #303040 a #[0-9a-f]{6}$/);
    // one fix cures the pair it names; the others of the same colour are cured by the next ones
    for (let i = 0; i < 10 && within(dialog).queryAllByRole("listitem").length > 0; i += 1) {
      await user.click(within(dialog).getAllByRole("button", { name: /^Correggi: / })[0]);
    }
    expect(within(dialog).queryAllByRole("listitem")).toHaveLength(0);
    expect(save()).toHaveAttribute("aria-disabled", "false");

    await type(user, "Sfondo", "#777777");
    await type(user, "Pannello", "#777777");
    await type(user, "Testo", "#808080");
    const all = within(dialog).getByRole("button", { name: "Correggi tutto" });
    await user.click(all);
    for (let i = 0; i < 10 && within(dialog).queryAllByRole("listitem").length > 0; i += 1) {
      await user.click(within(dialog).getAllByRole("button", { name: /^Correggi: / })[0]);
    }
    expect(within(dialog).queryAllByRole("listitem")).toHaveLength(0);
    expect(save()).toHaveAttribute("aria-disabled", "false");
  });

  it("saves, dresses the page, and the menu then offers «Personale» as the chosen palette", async () => {
    const { user } = await openEditor();
    await type(user, "Accento", "#e0a030");
    await user.click(save());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("custom");
    expect(readStoredCustom(localStorage)!.seeds.accent).toBe("#e0a030");
    expect(document.documentElement.dataset.jhtTheme).toBe("custom");
    for (const name of TOKEN_NAMES) expect(document.documentElement.style.getPropertyValue(name), name).not.toBe("");
    await user.click(screen.getByRole("button", { name: /Cambia tema/ }));
    expect(screen.getByRole("menuitemradio", { name: /Personale/ })).toHaveAttribute("aria-checked", "true");
  });

  it("changes nothing on Cancel", async () => {
    const { user } = await openEditor();
    await type(user, "Accento", "#e0a030");
    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(CUSTOM_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.jhtTheme).not.toBe("custom");
  });

  it("goes back to the starting palette on request", async () => {
    const { user } = await openEditor();
    await type(user, "Accento", "#e0a030");
    await user.click(screen.getByRole("button", { name: "Torna al tema di partenza" }));
    expect(textField("Accento")).toHaveValue(PRESETS.dark.seeds.accent);
  });

  it("deletes the saved palette only after a question, and the system's palette comes back", async () => {
    const first = await openEditor();
    await first.user.click(save());
    cleanup();
    const { user } = await openEditor();
    await user.click(screen.getByRole("button", { name: "Elimina il tema personale" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Eliminare il tema personale?");
    expect(readStoredCustom(localStorage)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "No, tienilo" }));
    expect(readStoredCustom(localStorage)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Elimina il tema personale" }));
    await user.click(screen.getByRole("button", { name: "Sì, elimina" }));
    expect(readStoredCustom(localStorage)).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement.style.getPropertyValue("--color-panel")).toBe("");
  });

  it("speaks the app's language", async () => {
    setLocale("en");
    render(<ThemePicker />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Change theme/ }));
    await user.click(screen.getByRole("menuitem", { name: "Customise…" }));
    const dialog = screen.getByRole("dialog", { name: "Personal theme" });
    await user.clear(within(dialog).getByRole("textbox", { name: "Text: colour code" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Text: colour code" }), "#303040");
    expect(within(dialog).getAllByRole("listitem")[0].textContent).toMatch(/Text on .+: \d\.\d : 1, at least 4\.5 : 1 is needed/);
  });
});

describe("a theme that comes in and goes out as text", { timeout: 60_000 }, () => {
  const GOOD_FILE = { jhtTheme: 1, name: "Il mio tema", start: "ocean", seeds: { background: "#0b1020", panel: "#11172b", text: "#c8d0ea", border: "#2a3558", accent: "#7cc4ff" } };
  const asFile = (value: unknown, name = "tema.json") => new File([typeof value === "string" ? value : JSON.stringify(value)], name, { type: "application/json" });
  const noteOf = (dialog: HTMLElement) => dialog.querySelector(".theme-editor__note")!.textContent;
  const clipboard = (writeText: () => Promise<void>) => Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  it("imports a file as a DRAFT: the editor takes its palette and colours, and nothing is saved or applied", async () => {
    const { user, dialog } = await openEditor();
    await user.upload(screen.getByTestId("theme-file-input"), asFile(GOOD_FILE));
    await vi.waitFor(() => expect(noteOf(dialog)).toBe("Importato: Il mio tema. Controlla l'anteprima e salva se va bene."));
    expect(textField("Accento")).toHaveValue("#7cc4ff");
    expect(within(dialog).getByRole("combobox", { name: "Parti da" })).toHaveValue("ocean");
    expect(localStorage.getItem(CUSTOM_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--color-green")).toBe("");
    expect(screen.getByTestId("theme-preview").style.getPropertyValue("--color-green")).toBe("#7cc4ff");
  });

  it("does not even read a file over 4 KiB, and says why", async () => {
    const { user, dialog } = await openEditor();
    const big = asFile("x".repeat(4097));
    const read = vi.spyOn(FileReader.prototype, "readAsText");
    await user.upload(screen.getByTestId("theme-file-input"), big);
    await vi.waitFor(() => expect(noteOf(dialog)).toBe("Il file è troppo grande per essere un tema (al massimo 4 KB)."));
    expect(read).not.toHaveBeenCalled();
    expect(textField("Accento")).toHaveValue(PRESETS.dark.seeds.accent);
  });

  it.each([
    ["not JSON", "{", "Il file non è un tema: non si legge come testo JSON."],
    ["a version from the future", { ...GOOD_FILE, jhtTheme: 2 }, "Il file è stato creato da una versione più nuova dell'app."],
    ["a colour name", { ...GOOD_FILE, seeds: { ...GOOD_FILE.seeds, accent: "red" } }, "Il file non è un tema valido (campo: seeds.accent)."],
    ["an extra key", { ...GOOD_FILE, look: {} }, "Il file non è un tema valido (campo: keys)."],
  ])("refuses a file with %s, tells the person, and leaves the editor as it was", async (_name, content, message) => {
    const { user, dialog } = await openEditor();
    await user.upload(screen.getByTestId("theme-file-input"), asFile(content as unknown));
    await vi.waitFor(() => expect(noteOf(dialog)).toBe(message));
    expect(textField("Accento")).toHaveValue(PRESETS.dark.seeds.accent);
    expect(within(dialog).getByRole("combobox", { name: "Parti da" })).toHaveValue("dark");
  });

  it("brings a well-formed but unreadable palette into the editor with the list of why, and Save stays off", async () => {
    const { user, dialog } = await openEditor();
    const unreadable = { ...GOOD_FILE, seeds: { ...GOOD_FILE.seeds, text: "#11172b" } };
    await user.upload(screen.getByTestId("theme-file-input"), asFile(unreadable));
    await vi.waitFor(() => expect(within(dialog).queryAllByRole("listitem").length).toBeGreaterThan(0));
    expect(save()).toHaveAttribute("aria-disabled", "true");
    await user.click(save());
    expect(localStorage.getItem(CUSTOM_STORAGE_KEY)).toBeNull();
  });

  it("copies the theme as text the app reads back to the same colours; a theme that does not read well is not copied", async () => {
    const writeText = vi.fn(async () => {});
    const { user, dialog } = await openEditor();
    clipboard(writeText);
    await type(user, "Accento", "#e0a030");
    await user.click(screen.getByRole("button", { name: "Copia il tema" }));
    await vi.waitFor(() => expect(noteOf(dialog)).toBe("Tema copiato negli appunti."));
    const out = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(readThemeFile(out)).toEqual({ ok: true, file: { jhtTheme: 1, name: "Tema personale", start: "dark", seeds: { ...PRESETS.dark.seeds, accent: "#e0a030" } } });
    expect(out).toBe(writeThemeFile("Tema personale", "dark", { ...PRESETS.dark.seeds, accent: "#e0a030" }));

    await type(user, "Testo", "#303040");
    writeText.mockClear();
    await user.click(screen.getByRole("button", { name: "Copia il tema" }));
    expect(noteOf(dialog)).toBe("Un tema che non si legge bene non si esporta: correggi prima ciò che non va.");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("puts the text in the box to be copied by hand when there is no clipboard", async () => {
    const { user, dialog } = await openEditor();
    clipboard(async () => {
      throw new Error("denied");
    });
    await user.click(screen.getByRole("button", { name: "Copia il tema" }));
    const box = await within(dialog).findByRole("textbox", { name: "Testo del tema" });
    expect((box as HTMLTextAreaElement).value).toContain('"jhtTheme": 1');
    expect(noteOf(dialog)).toBe("Appunti non disponibili: il testo del tema è nella casella, copialo a mano.");
  });

  it("imports a pasted text the same way, closes the box, and a text that is not a theme leaves it open", async () => {
    const { user, dialog } = await openEditor();
    await user.click(screen.getByRole("button", { name: "Incolla un tema" }));
    const box = within(dialog).getByRole("textbox", { name: "Testo del tema" });
    await user.click(box);
    await user.paste("non è un tema");
    await user.click(within(dialog).getByRole("button", { name: "Importa" }));
    expect(noteOf(dialog)).toBe("Il file non è un tema: non si legge come testo JSON.");
    expect(within(dialog).getByRole("textbox", { name: "Testo del tema" })).toBeInTheDocument();
    await user.clear(box);
    await user.click(box);
    await user.paste(JSON.stringify(GOOD_FILE));
    await user.click(within(dialog).getByRole("button", { name: "Importa" }));
    expect(textField("Accento")).toHaveValue("#7cc4ff");
    expect(within(dialog).queryByRole("textbox", { name: "Testo del tema" })).toBeNull();
  });
});
