import type { ApiKeyProviderName } from "../lib/onboarding";
import { keyShapeOk } from "../lib/provider-key";
import { ONBOARDING_API_KEY_TEXT } from "./onboarding-api-key.i18n";
import type { Locale } from "@/i18n/config";

/**
 * «Or use an API key» under the subscription of the first setup's provider step: glm or kimi, which work on Pi with a key and have no
 * sign-in. The person picks one and pastes the key in a password field; the setup sends it to the native side apart from its own request
 * (stageOnboardingProviderKey) and empties the field. Nothing is stored here: the field lives only in the page's state.
 */
export default function ApiKeyChoice({ locale, provider, apiKey, shapeWrong, onProvider, onKey }: {
  locale: Locale;
  provider: ApiKeyProviderName | null;
  apiKey: string;
  shapeWrong: boolean;
  onProvider: (provider: ApiKeyProviderName | null) => void;
  onKey: (key: string) => void;
}) {
  const t = ONBOARDING_API_KEY_TEXT[locale];
  const options: Array<{ value: ApiKeyProviderName; label: string; vendor: string; mark: string }> = [
    { value: "glm", label: t.glm, vendor: t.vendorGlm, mark: "GL" },
    { value: "kimi", label: t.kimi, vendor: t.vendorKimi, mark: "KM" },
  ];
  return (
    <section className="onboarding-api-key" data-testid="api-key-choice" aria-label={t.title}>
      <h3 className="onboarding-api-key__title">{t.title}</h3>
      <p className="onboarding-subscription-note">{t.text}</p>
      <div className="onboarding-choice-grid onboarding-choice-grid--providers" role="radiogroup" aria-label={t.groupAria}>
        {options.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            data-testid={`api-key-provider-${item.value}`}
            aria-checked={provider === item.value}
            className={`onboarding-choice${provider === item.value ? " is-selected" : ""}`}
            onClick={() => onProvider(provider === item.value ? null : item.value)}
          >
            <span className="onboarding-choice__icon">{item.mark}</span>
            <strong>{item.label}</strong>
            <small>{item.vendor}</small>
            <span className="onboarding-choice__check">✓</span>
          </button>
        ))}
      </div>
      {provider !== null && (
        <div className="onboarding-api-key__field">
          <label htmlFor="onboarding-api-key-input">{t.label}</label>
          <input
            id="onboarding-api-key-input"
            data-testid="api-key-input"
            type="password"
            name="jht-onboarding-api-key"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={apiKey}
            placeholder={t.placeholder}
            aria-invalid={shapeWrong || (apiKey.length > 0 && !keyShapeOk(apiKey))}
            onChange={(event) => onKey(event.target.value)}
          />
          {shapeWrong && <p role="alert" className="onboarding-error" data-testid="api-key-shape">{t.shape}</p>}
          <button type="button" className="onboarding-secondary" data-testid="api-key-back" onClick={() => onProvider(null)}>{t.keep}</button>
        </div>
      )}
    </section>
  );
}
