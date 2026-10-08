import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../../lib/app-locale";
import { describeError, errorCodeOf } from "../../lib/error-catalog";
import {
  MAIL_SAVED_EVENT,
  mailStatus,
  saveMailPassword,
  type MailPasswordRequest,
  type MailStatus,
} from "../../lib/mail";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import { MAIL_TEXT } from "./mail.i18n";

type Load = { state: "loading" } | { state: "ready"; status: MailStatus } | { state: "failed"; message: string };

function catalogMessage(error: unknown, fallback: string, locale: Locale): string {
  const described = describeError(errorCodeOf(error), { fallback, locale });
  return `${described.text} ${described.action}`;
}

/**
 * /mail: the team's mailbox. Its state (address, configured, rotation
 * pending) and a form to save a new app password. The password goes to the
 * host's command on stdin only (mail.rs); the field is cleared after every
 * attempt.
 */
export function MailScreen({
  loadStatus = mailStatus,
  save = saveMailPassword,
  locale: localeOverride,
}: {
  loadStatus?: () => Promise<MailStatus>;
  save?: (request: MailPasswordRequest) => Promise<void>;
  /** The page's language; the app's own (lib/app-locale.ts) when absent. */
  locale?: Locale;
}) {
  const locale = localeOverride ?? appLocale();
  const t = MAIL_TEXT[locale];
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [address, setAddress] = useState("");
  const [dedicated, setDedicated] = useState<"yes" | "no" | null>(null);
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const read = useCallback(() => {
    loadStatus()
      .then((status) => {
        setLoad({ state: "ready", status });
        setAddress((current) => current || status.address || "");
      })
      .catch((error) => setLoad({ state: "failed", message: catalogMessage(error, "mail_unavailable", locale) }));
  }, [loadStatus, locale]);

  useEffect(read, [read]);
  useRefresh(read);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || dedicated === null) return;
    setSaving(true);
    setResult(null);
    try {
      await save({
        address: address.trim(),
        dedicated: dedicated === "yes",
        imapHost: imapHost.trim() || undefined,
        smtpHost: smtpHost.trim() || undefined,
        password,
      });
      setResult({ ok: true, message: t.saved });
      window.dispatchEvent(new CustomEvent(MAIL_SAVED_EVENT));
      read();
    } catch (error) {
      setResult({ ok: false, message: catalogMessage(error, "mail_save_failed", locale) });
    } finally {
      // Never kept on screen after an attempt, saved or not.
      setPassword("");
      setSaving(false);
    }
  }

  const status = load.state === "ready" ? load.status : null;
  return (
    <section className="max-w-3xl mx-auto px-5 py-8" aria-labelledby="mail-title">
      <h1 id="mail-title" className="text-[16px] font-bold">{t.title}</h1>
      <p className="mt-1 text-[12px] text-[var(--color-muted)]">{t.intro}</p>

      <dl className="mt-5 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px]" aria-label={t.statusAria}>
        <dt className="text-[var(--color-muted)]">{t.status}</dt>
        <dd>
          {load.state === "loading" && t.checking}
          {load.state === "failed" && <span role="alert">{load.message}</span>}
          {status && (status.configured ? t.configured : t.notConfigured)}
        </dd>
        <dt className="text-[var(--color-muted)]">{t.address}</dt>
        <dd>{status?.address ?? "—"}</dd>
        <dt className="text-[var(--color-muted)]">{t.password}</dt>
        <dd>
          {status?.rotationPending
            ? t.rotationPending
            : status?.configured
              ? t.passwordOk
              : "—"}
        </dd>
      </dl>

      <form className="mt-6 flex flex-col gap-3 text-[12px]" onSubmit={(event) => void submit(event)} aria-label={t.formAria}>
        <h2 className="text-[13px] font-semibold">{t.formTitle}</h2>
        <label className="flex flex-col gap-1">
          {t.mailboxAddress}
          <input
            type="email"
            required
            autoComplete="off"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1.5"
          />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend>{t.dedicatedLegend}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="dedicated" required checked={dedicated === "yes"} onChange={() => setDedicated("yes")} />
            {t.dedicatedYes}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="dedicated" required checked={dedicated === "no"} onChange={() => setDedicated("no")} />
            {t.dedicatedNo}
          </label>
        </fieldset>
        <details>
          <summary>{t.serversSummary}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              {t.imapServer}
              <input value={imapHost} onChange={(event) => setImapHost(event.target.value)} autoComplete="off" className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1">
              {t.smtpServer}
              <input value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} autoComplete="off" className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1.5" />
            </label>
          </div>
        </details>
        <label className="flex flex-col gap-1">
          {t.appPassword}
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1.5"
          />
        </label>
        <button
          type="submit"
          disabled={saving || dedicated === null || !password || !address.trim()}
          className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-semibold"
        >
          {saving ? t.saving : t.save}
        </button>
        {result && (
          <p role={result.ok ? "status" : "alert"} style={result.ok ? undefined : { color: "var(--color-red)" }}>
            {result.message}
          </p>
        )}
      </form>
    </section>
  );
}

export default function MailPage(_props: PageProps) {
  return <MailScreen />;
}
