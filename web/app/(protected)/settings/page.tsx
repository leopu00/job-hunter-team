"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { Tabs, Tab } from "../../components/Tabs";
import { useToast } from "../../components/Toast";
import SettingsProfile from "../../components/SettingsProfile";
import {
  AccountCard,
  LanguageCard,
  CurrencyCard,
  ConnectTeamCard,
} from "../../components/SettingsCloudSections";
import WorkHoursPicker from "../../components/WorkHoursPicker";
import { DarkModeToggle } from "@/app/theme-provider";
import { AVAILABLE_CURRENCIES, BASE_CURRENCIES } from "@/lib/exchange-rates";
import { useLocale } from "@/lib/use-locale";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./page.i18n";

type NotifKey = "telegram" | "email" | "desktop";
type Settings = {
  app_name: string;
  language: string;
  notifications: Record<NotifKey, boolean>;
  // Valute extra (oltre alle base EUR/USD/GBP) per il grafico stipendi.
  currencies: string[];
};

const DEFAULTS: Settings = {
  app_name: "Job Hunter Team",
  language: "it",
  notifications: { telegram: true, email: false, desktop: false },
  currencies: [],
};

const BASE = BASE_CURRENCIES as readonly string[];

const inp: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  background: "var(--color-card)",
  color: "var(--color-bright)",
  borderRadius: 6,
  fontSize: 11,
  padding: "6px 10px",
  fontFamily: "var(--font-mono)",
  width: "100%",
  transition: "border-color 0.15s",
};

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-[11px] font-semibold"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </label>
      {hint && (
        <p className="text-[9px]" style={{ color: "var(--color-dim)" }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="flex items-center gap-3 cursor-pointer select-none"
      onClick={() => onChange(!checked)}
    >
      <div
        className="relative w-9 h-5 rounded-full transition-colors"
        style={{
          background: checked ? "var(--color-green)" : "var(--color-border)",
        }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
          style={{
            background: "white",
            transform: checked ? "translateX(18px)" : "translateX(2px)",
          }}
        />
      </div>
      <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
        {label}
      </span>
    </label>
  );
}

function SaveBtn({
  busy,
  onClick,
  savingLabel,
  saveLabel,
}: {
  busy: boolean;
  onClick: () => void;
  savingLabel: string;
  saveLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="self-start px-5 py-2 rounded text-[11px] font-bold cursor-pointer transition-all"
      style={{
        background: busy ? "var(--color-border)" : "var(--color-green)",
        color: busy ? "var(--color-dim)" : "var(--color-void)",
        border: "none",
      }}
    >
      {busy ? savingLabel : saveLabel}
    </button>
  );
}

type TabId =
  | "profile"
  | "general"
  | "working-hours"
  | "currencies"
  | "notifications"
  | "security"
  | "danger";

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loading, setL] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>("profile");
  const [curQuery, setCurQuery] = useState("");
  const { toast } = useToast();
  const locale = useLocale();
  const tr = makeT(T, locale);
  // [JHT-DASHBOARD-SPLIT rivisto 20/07] La pagina non è più desktop-only:
  // sul cloud si riduce alle sole sezioni che lì funzionano davvero (tema,
  // client-side, + link a cloud-sync). Le tab di config locale (jht.config,
  // orari, valute, notifiche, danger) restano solo su desktop/locale.
  const isCloud = useIsCloud();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ config }) => {
        if (config)
          setS({
            app_name: config.app?.name ?? DEFAULTS.app_name,
            language: config.app?.language ?? DEFAULTS.language,
            notifications: {
              ...DEFAULTS.notifications,
              ...config.notifications,
            },
            currencies: Array.isArray(config.dashboard?.currencies)
              ? config.dashboard.currencies.filter(
                  (c: string) => !BASE.includes(c),
                )
              : [],
          });
        setL(false);
      })
      .catch(() => setL(false));
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app: { name: s.app_name, language: s.language },
          notifications: s.notifications,
          dashboard: { currencies: s.currencies },
        }),
      });
      const d = await r.json();
      d.ok
        ? toast(tr("settings_saved"), "success")
        : toast(d.error ?? tr("error"), "error");
    } catch {
      toast(tr("network_error"), "error");
    } finally {
      setBusy(false);
    }
  }, [s, toast]);

  const dangerAction = useCallback(
    async (act: string, label: string) => {
      setBusy(true);
      try {
        const r = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ _action: act }),
        });
        const d = await r.json();
        d.ok
          ? toast(tr("action_done").replace("{label}", label), "success")
          : toast(d.error ?? tr("error"), "error");
      } catch {
        toast(tr("network_error"), "error");
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  // Variante CLOUD: solo ciò che sul cloud funziona ed è utile — tema
  // (preferenza client) e gestione token di sincronizzazione.
  if (isCloud === true)
    return (
      <main
        className="min-h-screen px-6 py-10"
        style={{ animation: "fade-in 0.35s ease both" }}
      >
        <div className="max-w-2xl mx-auto flex flex-col gap-6">
          <div>
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-2 mb-3"
            >
              <Link
                href="/dashboard"
                className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
              >
                {tr("dashboard")}
              </Link>
              <span className="text-[var(--color-border)]" aria-hidden="true">
                /
              </span>
              <span
                className="text-[10px] text-[var(--color-muted)]"
                aria-current="page"
              >
                {tr("settings")}
              </span>
            </nav>
            <h1
              className="text-xl font-bold"
              style={{ color: "var(--color-white)" }}
            >
              {tr("settings")}
            </h1>
          </div>

          {/* [JHT-WEB-DEMO] Promemoria pairing: solo finché non ci sono
              dati sincronizzati (la card si nasconde da sé). */}
          <ConnectTeamCard />

          <AccountCard />

          <LanguageCard />

          <CurrencyCard />

          <Link
            href="/settings/notifications"
            className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg no-underline transition-colors hover:border-[var(--color-border-glow)]"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            <div>
              <p
                className="m-0 text-[11px] font-semibold"
                style={{ color: "var(--color-muted)" }}
              >
                {tr("web_notifications")}
              </p>
              <p
                className="m-0 text-[10px]"
                style={{ color: "var(--color-dim)" }}
              >
                {tr("web_notifications_desc")}
              </p>
            </div>
            <span className="text-[10px] font-semibold tracking-widest uppercase shrink-0 text-[var(--color-green)]">
              {tr("open")}
            </span>
          </Link>

          <Link
            href="/settings/cloud-sync"
            className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg no-underline transition-colors hover:border-[var(--color-border-glow)]"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            <div>
              <p
                className="m-0 text-[11px] font-semibold"
                style={{ color: "var(--color-muted)" }}
              >
                {tr("cloud_sync")}
              </p>
              <p
                className="m-0 text-[10px]"
                style={{ color: "var(--color-dim)" }}
              >
                {tr("cloud_sync_desc")}
              </p>
            </div>
            <span className="text-[10px] font-semibold tracking-widest uppercase shrink-0 text-[var(--color-green)]">
              {tr("open")}
            </span>
          </Link>

          {/* Tema per ultimo (scelta utente 21/07). */}
          <div
            className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            <p
              className="m-0 text-[11px] font-semibold"
              style={{ color: "var(--color-muted)" }}
            >
              {tr("theme")}
            </p>
            <DarkModeToggle />
          </div>
        </div>
      </main>
    );

  if (loading)
    return (
      <main className="p-10" role="status" aria-live="polite">
        <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          {tr("loading")}
        </p>
      </main>
    );

  const TABS: Tab<TabId>[] = [
    { id: "profile", label: tr("tab_profile") },
    { id: "general", label: tr("tab_general") },
    { id: "working-hours", label: tr("tab_working_hours") },
    { id: "currencies", label: tr("tab_currencies") },
    { id: "notifications", label: tr("tab_notifications") },
    { id: "security", label: tr("tab_security") },
    { id: "danger", label: tr("tab_danger") },
  ];

  return (
    <main
      className="min-h-screen px-6 py-10"
      style={{ animation: "fade-in 0.35s ease both" }}
    >
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
            <Link
              href="/dashboard"
              className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
            >
              {tr("dashboard")}
            </Link>
            <span className="text-[var(--color-border)]" aria-hidden="true">
              /
            </span>
            <span
              className="text-[10px] text-[var(--color-muted)]"
              aria-current="page"
            >
              {tr("settings")}
            </span>
          </nav>
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--color-white)" }}
          >
            {tr("settings")}
          </h1>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        <div className="flex flex-col gap-5 pt-1">
          {tab === "profile" && <SettingsProfile />}

          {tab === "general" && (
            <>
              {/* Lingua della UI (7 locali): qui perché il selettore in
                  navbar è stato rimosso (21/07). Distinta da "Lingua
                  default" sotto, che è la lingua del workspace jht.config. */}
              <LanguageCard />
              <Row label={tr("app_name")}>
                <input
                  style={inp}
                  value={s.app_name}
                  onChange={(e) =>
                    setS((p) => ({ ...p, app_name: e.target.value }))
                  }
                  aria-label={tr("app_name")}
                />
              </Row>
              <Row label={tr("default_language")}>
                <select
                  style={inp}
                  value={s.language}
                  onChange={(e) =>
                    setS((p) => ({ ...p, language: e.target.value }))
                  }
                  aria-label={tr("language")}
                >
                  <option value="it">Italiano</option>
                  <option value="en">English</option>
                </select>
              </Row>
              <Row label={tr("theme")}>
                <DarkModeToggle />
              </Row>
              <SaveBtn
                busy={busy}
                onClick={save}
                savingLabel={tr("saving")}
                saveLabel={tr("save")}
              />
            </>
          )}

          {tab === "working-hours" && <WorkHoursPicker />}

          {tab === "currencies" && (
            <>
              <p
                className="text-[11px]"
                style={{ color: "var(--color-muted)" }}
              >
                {tr("cur_intro_a")}
                <strong> {tr("cur_intro_chart")}</strong>
                {tr("cur_intro_b")}
              </p>
              <input
                style={{ ...inp, maxWidth: 320 }}
                value={curQuery}
                onChange={(e) => setCurQuery(e.target.value)}
                placeholder={tr("cur_search_ph")}
                aria-label={tr("cur_search_aria")}
              />
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_CURRENCIES.filter((c) => {
                  const q = curQuery.trim().toLowerCase();
                  return (
                    !q ||
                    c.code.toLowerCase().includes(q) ||
                    c.name.toLowerCase().includes(q)
                  );
                }).map((c) => {
                  const isBase = BASE.includes(c.code);
                  const active = isBase || s.currencies.includes(c.code);
                  return (
                    <button
                      key={c.code}
                      type="button"
                      disabled={isBase}
                      onClick={() =>
                        setS((p) => ({
                          ...p,
                          currencies: p.currencies.includes(c.code)
                            ? p.currencies.filter((x) => x !== c.code)
                            : [...p.currencies, c.code],
                        }))
                      }
                      title={isBase ? tr("cur_always_available") : c.name}
                      className="flex items-center gap-2 px-3 py-2 rounded text-[11px] transition-colors"
                      style={{
                        border: `1px solid ${active ? "var(--color-green)" : "var(--color-border)"}`,
                        background: active
                          ? "rgba(0,232,122,0.08)"
                          : "var(--color-card)",
                        color: active
                          ? "var(--color-bright)"
                          : "var(--color-muted)",
                        cursor: isBase ? "default" : "pointer",
                        opacity: isBase ? 0.85 : 1,
                      }}
                    >
                      <span className="font-semibold tabular-nums">
                        {c.code}
                      </span>
                      <span style={{ color: "var(--color-dim)" }}>
                        {c.name}
                      </span>
                      {isBase && (
                        <span
                          className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded"
                          style={{
                            background: "var(--color-border)",
                            color: "var(--color-dim)",
                          }}
                        >
                          {tr("cur_base")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <SaveBtn
                busy={busy}
                onClick={save}
                savingLabel={tr("saving")}
                saveLabel={tr("save")}
              />
            </>
          )}
          {tab === "notifications" && (
            <>
              <p
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: "var(--color-dim)" }}
              >
                {tr("channels")}
              </p>
              {(["telegram", "email", "desktop"] as NotifKey[]).map((k) => (
                <Toggle
                  key={k}
                  checked={s.notifications[k]}
                  label={
                    k === "telegram"
                      ? "Telegram"
                      : k === "email"
                        ? "Email"
                        : tr("notif_desktop")
                  }
                  onChange={(v) =>
                    setS((p) => ({
                      ...p,
                      notifications: { ...p.notifications, [k]: v },
                    }))
                  }
                />
              ))}
              <SaveBtn
                busy={busy}
                onClick={save}
                savingLabel={tr("saving")}
                saveLabel={tr("save")}
              />
            </>
          )}

          {tab === "security" && (
            <>
              <Row label={tr("new_password")} hint={tr("next_version")}>
                <input
                  type="password"
                  style={{ ...inp, opacity: 0.4, cursor: "not-allowed" }}
                  disabled
                  placeholder="••••••••"
                />
              </Row>
              <div
                className="flex items-center gap-3 px-3 py-2.5 rounded"
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-card)",
                }}
              >
                <span
                  className="text-[9px] px-2 py-0.5 rounded"
                  style={{
                    background: "rgba(255,196,0,0.1)",
                    color: "var(--color-yellow)",
                    border: "1px solid rgba(255,196,0,0.2)",
                  }}
                >
                  {tr("coming_soon")}
                </span>
                <p
                  className="text-[10px]"
                  style={{ color: "var(--color-dim)" }}
                >
                  {tr("totp_hint")}
                </p>
              </div>
            </>
          )}

          {tab === "danger" && (
            <>
              <div
                className="px-4 py-3 rounded"
                style={{
                  background: "rgba(255,69,96,0.06)",
                  border: "1px solid rgba(255,69,96,0.2)",
                }}
              >
                <p
                  className="text-[10px] font-bold"
                  style={{ color: "var(--color-red)" }}
                >
                  {tr("danger_warning")}
                </p>
              </div>
              {[
                {
                  act: "reset_config",
                  label: tr("reset_config_label"),
                  desc: tr("reset_config_desc"),
                },
                {
                  act: "clear_cache",
                  label: tr("clear_cache_label"),
                  desc: tr("clear_cache_desc"),
                },
              ].map(({ act, label, desc }) => (
                <div
                  key={act}
                  className="flex items-center justify-between gap-4 px-4 py-3 rounded"
                  style={{
                    border: "1px solid var(--color-border)",
                    background: "var(--color-card)",
                  }}
                >
                  <div>
                    <p
                      className="text-[11px] font-semibold"
                      style={{ color: "var(--color-muted)" }}
                    >
                      {label}
                    </p>
                    <p
                      className="text-[10px]"
                      style={{ color: "var(--color-dim)" }}
                    >
                      {desc}
                    </p>
                  </div>
                  <button
                    onClick={() => dangerAction(act, label)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer flex-shrink-0 transition-all"
                    style={{
                      border: "1px solid rgba(255,69,96,0.4)",
                      color: "var(--color-red)",
                      background: "transparent",
                    }}
                  >
                    {label}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
