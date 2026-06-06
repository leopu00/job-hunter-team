"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { Tabs, Tab } from "../../components/Tabs";
import { useToast } from "../../components/Toast";
import SettingsProfile from "../../components/SettingsProfile";
import { AVAILABLE_CURRENCIES, BASE_CURRENCIES } from "@/lib/exchange-rates";

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

function SaveBtn({ busy, onClick }: { busy: boolean; onClick: () => void }) {
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
      {busy ? "Salvataggio…" : "Salva"}
    </button>
  );
}

type TabId =
  | "profile"
  | "general"
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
        ? toast("Impostazioni salvate", "success")
        : toast(d.error ?? "Errore", "error");
    } catch {
      toast("Errore di rete", "error");
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
          ? toast(`${label} completato`, "success")
          : toast(d.error ?? "Errore", "error");
      } catch {
        toast("Errore di rete", "error");
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  if (loading)
    return (
      <main className="p-10" role="status" aria-live="polite">
        <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          Caricamento…
        </p>
      </main>
    );

  const TABS: Tab<TabId>[] = [
    { id: "profile", label: "Profilo" },
    { id: "general", label: "Generale" },
    { id: "currencies", label: "Valute" },
    { id: "notifications", label: "Notifiche" },
    { id: "security", label: "Sicurezza" },
    { id: "danger", label: "Danger Zone" },
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
              Dashboard
            </Link>
            <span className="text-[var(--color-border)]" aria-hidden="true">
              /
            </span>
            <span
              className="text-[10px] text-[var(--color-muted)]"
              aria-current="page"
            >
              Impostazioni
            </span>
          </nav>
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--color-white)" }}
          >
            Impostazioni
          </h1>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        <div className="flex flex-col gap-5 pt-1">
          {tab === "profile" && <SettingsProfile />}

          {tab === "general" && (
            <>
              <Row label="Nome applicazione">
                <input
                  style={inp}
                  value={s.app_name}
                  onChange={(e) =>
                    setS((p) => ({ ...p, app_name: e.target.value }))
                  }
                  aria-label="Nome applicazione"
                />
              </Row>
              <Row label="Lingua default">
                <select
                  style={inp}
                  value={s.language}
                  onChange={(e) =>
                    setS((p) => ({ ...p, language: e.target.value }))
                  }
                  aria-label="Lingua"
                >
                  <option value="it">Italiano</option>
                  <option value="en">English</option>
                </select>
              </Row>
              <SaveBtn busy={busy} onClick={save} />
            </>
          )}

          {tab === "currencies" && (
            <>
              <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                Le valute selezionate appariranno nel selettore del grafico
                <strong> Distribuzione Stipendi</strong>. EUR, USD e GBP sono
                sempre disponibili; aggiungine altre (es. il fiorino ungherese)
                per convertire le stime nella valuta che preferisci.
              </p>
              <input
                style={{ ...inp, maxWidth: 320 }}
                value={curQuery}
                onChange={(e) => setCurQuery(e.target.value)}
                placeholder="Cerca valuta (codice o nome)…"
                aria-label="Cerca valuta"
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
                      title={isBase ? "Sempre disponibile" : c.name}
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
                      <span style={{ color: "var(--color-dim)" }}>{c.name}</span>
                      {isBase && (
                        <span
                          className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded"
                          style={{
                            background: "var(--color-border)",
                            color: "var(--color-dim)",
                          }}
                        >
                          base
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <SaveBtn busy={busy} onClick={save} />
            </>
          )}

          {tab === "notifications" && (
            <>
              <p
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: "var(--color-dim)" }}
              >
                Canali
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
                        : "Desktop (browser)"
                  }
                  onChange={(v) =>
                    setS((p) => ({
                      ...p,
                      notifications: { ...p.notifications, [k]: v },
                    }))
                  }
                />
              ))}
              <SaveBtn busy={busy} onClick={save} />
            </>
          )}

          {tab === "security" && (
            <>
              <Row
                label="Nuova password"
                hint="Disponibile in una prossima versione"
              >
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
                  Presto disponibile
                </span>
                <p
                  className="text-[10px]"
                  style={{ color: "var(--color-dim)" }}
                >
                  2FA via TOTP (Google Authenticator)
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
                  Attenzione — azioni irreversibili
                </p>
              </div>
              {[
                {
                  act: "reset_config",
                  label: "Reset configurazione",
                  desc: "Ripristina jht.config.json ai valori di default",
                },
                {
                  act: "clear_cache",
                  label: "Svuota cache",
                  desc: "Elimina tutti i file in ~/.jht/cache/",
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
