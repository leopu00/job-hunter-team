import { useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { readHarnessChoice, type HarnessOutcome } from "../../lib/harness-choice";
import { apiKeyProviderOf } from "../../lib/key-refused";
import { keyShapeOk, saveProviderKey, type ProviderKeyName, type ProviderKeyOutcome } from "../../lib/provider-key";
import { PROVIDER_KEY_CARD_TEXT } from "./provider-key-card.i18n";

const cardCls = "rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2";
const buttonCls =
  "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-50";
const LABELS: Record<ProviderKeyName, string> = { glm: "GLM (Z.ai)", kimi: "Kimi (Moonshot)" };

/**
 * «API key» of the Settings (Team), only for a team that already runs on glm or kimi with a key (Pi): the person pastes a new key
 * when the provider refused the old one. It goes to the team's own setup on its standard input (provider_key.rs) and nowhere else:
 * the field is emptied the moment the person presses the button, the key is not kept in the page, and what comes back is one of two
 * words or a catalog code. The card is not offered for a team that works with a login, and it cannot switch the team to another
 * provider: the provider is the one the team already has. `read` and `save` are for the tests.
 */
export default function ProviderKeyCard({
  read = readHarnessChoice,
  save = saveProviderKey,
}: {
  read?: () => Promise<HarnessOutcome>;
  save?: (provider: ProviderKeyName, key: string) => Promise<ProviderKeyOutcome>;
}) {
  const t = PROVIDER_KEY_CARD_TEXT[appLocale()];
  const [provider, setProvider] = useState<ProviderKeyName | null>(null);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<"saved" | "refused" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shapeWrong, setShapeWrong] = useState(false);

  useEffect(() => {
    let live = true;
    void read()
      .catch((): HarnessOutcome => ({ ok: false, code: "harness_unavailable" }))
      .then((result) => {
        if (live) setProvider(result.ok ? apiKeyProviderOf(result.value) : null);
      });
    return () => {
      live = false;
    };
  }, [read]);

  if (!provider) return null;
  const label = LABELS[provider];

  async function submit() {
    if (pending || !provider) return;
    if (!keyShapeOk(key)) {
      setShapeWrong(true);
      return;
    }
    // The key leaves the page's state before the call: nothing of it stays here while the setup runs.
    const sent = key;
    setKey("");
    setShapeWrong(false);
    setSaved(null);
    setError(null);
    setPending(true);
    const result = await save(provider, sent).catch((): ProviderKeyOutcome => ({ ok: false, code: "provider_key_failed" }));
    if (result.ok) setSaved(result.state);
    else setError(result.code);
    setPending(false);
  }

  const told = error ? describeError(error, { locale: appLocale(), fallback: "provider_key_failed" }) : null;
  return (
    <section data-testid="settings-provider-key" aria-labelledby="settings-provider-key-title" className={cardCls}>
      <h2 id="settings-provider-key-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.title}</h2>
      <p className="text-[12px] text-[var(--color-muted)]">{t.text.replace("{provider}", label)}</p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="text-[12px] text-[var(--color-muted)]" htmlFor="provider-key-input">{t.label}</label>
        <input
          id="provider-key-input"
          data-testid="provider-key-input"
          type="password"
          name="jht-provider-api-key"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={key}
          placeholder={t.placeholder}
          disabled={pending}
          onChange={(event) => {
            setKey(event.target.value);
            setShapeWrong(false);
          }}
          className="rounded border border-[var(--color-border)] bg-[var(--color-void)] px-2 py-1.5 text-[13px] text-[var(--color-bright)]"
        />
        {shapeWrong && <p role="alert" data-testid="provider-key-shape" className="text-[12px]" style={{ color: "var(--color-red)" }}>{t.shape}</p>}
        <div>
          <button type="submit" data-testid="provider-key-save" className={buttonCls} disabled={pending || key.length === 0}>
            {pending ? t.saving : t.save}
          </button>
        </div>
      </form>
      {saved === "saved" && <p role="status" data-testid="provider-key-saved" className="text-[12px]">{t.saved}</p>}
      {saved === "refused" && <p role="alert" data-testid="provider-key-refused" className="text-[12px]" style={{ color: "var(--color-red)" }}>{t.refused.replace("{provider}", label)}</p>}
      {told && <p role="alert" data-testid="provider-key-error" className="text-[12px]" style={{ color: "var(--color-red)" }}>{told.text} {told.action}</p>}
    </section>
  );
}
