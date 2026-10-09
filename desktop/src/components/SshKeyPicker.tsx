import { useId, useState } from "react";
import { pickSshKey, sshKeyBasename, type SshKeySelector } from "../lib/ssh-key-picker";
import { appLocale } from "../lib/app-locale";
import { ONBOARDING_TEXT } from "../onboarding/onboarding.i18n";
import "./ssh-key-picker.css";

export interface SshKeyPickerProps {
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  pickKey?: SshKeySelector;
}

export default function SshKeyPicker({
  value,
  onChange,
  disabled = false,
  pickKey = pickSshKey,
}: SshKeyPickerProps) {
  const t = ONBOARDING_TEXT[appLocale()].sshKeyPicker;
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const hasSelection = value.length > 0;

  async function choose() {
    if (busy || disabled) return;
    setBusy(true);
    setUnavailable(false);
    try {
      const selected = await pickKey();
      if (selected !== null) onChange(selected);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    setUnavailable(false);
    onChange("");
  }

  return (
    <div className="ssh-key-picker" role="group" aria-labelledby={`${id}-label`}>
      <span className="ssh-key-picker__label" id={`${id}-label`}>{t.label}</span>
      <p className="ssh-key-picker__status" id={`${id}-status`} role="status">
        {hasSelection
          ? <>{t.selected} <strong>{sshKeyBasename(value)}</strong></>
          : t.none}
      </p>
      <div className="ssh-key-picker__actions">
        <button
          type="button"
          onClick={() => void choose()}
          disabled={disabled || busy}
          aria-describedby={`${id}-status`}
        >
          {busy ? t.opening : hasSelection ? t.change : t.choose}
        </button>
        {hasSelection && (
          <button
            className="ssh-key-picker__remove"
            type="button"
            onClick={remove}
            disabled={disabled || busy}
            aria-describedby={`${id}-status`}
          >
            {t.remove}
          </button>
        )}
      </div>
      {unavailable && (
        <p className="ssh-key-picker__error" role="alert">
          {t.unavailable}
        </p>
      )}
    </div>
  );
}
