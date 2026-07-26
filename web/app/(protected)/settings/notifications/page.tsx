"use client";

// [JHT-WEB-NOTIFICATIONS] Impostazioni notifiche browser (solo web cloud).
// Master switch + permesso browser, notifiche messaggi agenti, e regole
// configurabili sulle posizioni (trigger valutata/nuova, soglia score,
// location, paesi, keyword, work mode, digest a soglia). Le preferenze
// vengono lette/scritte DIRETTAMENTE su Supabase (RLS, mig 058) + cache
// localStorage per il runtime (useWebNotifications) e le altre tab.

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./page.i18n";
import {
  cachePrefs,
  normalizePrefs,
  DEFAULT_PREFS,
  type NotificationRule,
  type WebNotificationPrefs,
} from "@/lib/web-notifications";

function newRule(partial?: Partial<NotificationRule>): NotificationRule {
  return {
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    trigger: "scored",
    minScore: null,
    locations: [],
    countries: [],
    keywords: [],
    workMode: "any",
    minCount: 1,
    ...partial,
  };
}

function listToText(v: string[]): string {
  return v.join(", ");
}
function textToList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

const inputCls =
  "w-full px-2.5 py-1.5 text-[11.5px] bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[var(--color-base)] focus:outline-none focus:border-[var(--color-border-glow)]";
const labelCls =
  "block text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--color-dim)] mb-1";

function Toggle({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 text-left cursor-pointer py-1"
    >
      <span
        className="shrink-0 w-9 h-5 rounded-full relative transition-colors"
        style={{
          background: checked ? "var(--color-green)" : "var(--color-border)",
        }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-[var(--color-panel)] transition-all"
          style={{ left: checked ? "18px" : "2px" }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] text-[var(--color-bright)]">
          {label}
        </span>
        {desc && (
          <span className="block text-[10.5px] text-[var(--color-muted)] mt-0.5">
            {desc}
          </span>
        )}
      </span>
    </button>
  );
}

export default function NotificationSettingsPage() {
  const locale = useLocale();
  const tr = makeT(T, locale);
  const isCloud = useIsCloud();

  const [prefs, setPrefs] = useState<WebNotificationPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "ok" | "error">("idle");
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");

  useEffect(() => {
    setPermission(
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "unsupported",
    );
    const supabase = createClient();
    void (async () => {
      const { data } = (await supabase.auth.getSession()) as {
        data: { session: { user: { id: string } } | null };
      };
      setLoggedIn(!!data.session);
      if (!data.session) {
        setLoaded(true);
        return;
      }
      const res = await supabase
        .from("notification_prefs")
        .select("prefs")
        .maybeSingle();
      if (res.data?.prefs) setPrefs(normalizePrefs(res.data.prefs));
      setLoaded(true);
    })();
  }, []);

  async function handleMasterToggle(next: boolean) {
    if (next && permission === "default" && "Notification" in window) {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== "granted") return; // resta off finché il permesso non c'è
    }
    setPrefs((prev) => ({ ...prev, enabled: next }));
  }

  function updateRule(id: string, patch: Partial<NotificationRule>) {
    setPrefs((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveState("idle");
    try {
      const supabase = createClient();
      const { data } = (await supabase.auth.getSession()) as {
        data: { session: { user: { id: string } } | null };
      };
      if (!data.session) throw new Error("no session");
      const clean = normalizePrefs(prefs);
      const { error } = await supabase
        .from("notification_prefs")
        .upsert(
          { user_id: data.session.user.id, prefs: clean },
          { onConflict: "user_id" },
        );
      if (error) throw new Error(error.message);
      cachePrefs(clean); // il runtime e le altre tab si riallineano da qui
      setPrefs(clean);
      setSaveState("ok");
      window.setTimeout(() => setSaveState("idle"), 3000);
    } catch {
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }

  function handleTest() {
    if (permission !== "granted") return;
    try {
      new Notification("Job Hunter Team", { body: tr("test_body") });
    } catch {
      /* piattaforme senza costruttore Notification */
    }
  }

  const card =
    "border border-[var(--color-border)] bg-[var(--color-panel)] rounded-lg p-4";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/settings"
        className="text-[10px] tracking-[0.14em] uppercase text-[var(--color-dim)] hover:text-[var(--color-bright)] no-underline transition-colors"
      >
        ← {tr("breadcrumb")}
      </Link>
      <h1 className="text-[20px] font-bold tracking-[0.08em] uppercase text-[var(--color-bright)] mt-2 mb-1">
        {tr("title")}
      </h1>
      <p className="text-[11.5px] text-[var(--color-muted)] m-0 mb-6">
        {tr("subtitle")}
      </p>

      {isCloud === false && (
        <div className={`${card} mb-4 text-[11.5px] text-[var(--color-muted)]`}>
          {tr("cloud_only")}
        </div>
      )}

      {loaded && loggedIn === false && (
        <div
          className={`${card} mb-4 text-[11.5px] text-[var(--color-yellow)]`}
        >
          {tr("login_required")}
        </div>
      )}

      {/* ── Interruttori generali ── */}
      <div className={`${card} mb-4 flex flex-col gap-3`}>
        <Toggle
          checked={prefs.enabled}
          onChange={(v) => void handleMasterToggle(v)}
          label={tr("master")}
          desc={
            permission === "granted"
              ? tr("perm_granted")
              : permission === "denied"
                ? undefined
                : permission === "unsupported"
                  ? tr("no_support")
                  : tr("perm_needed")
          }
        />
        {permission === "denied" && (
          <p className="m-0 text-[10.5px] text-[var(--color-yellow)]">
            {tr("perm_denied")}
          </p>
        )}
        <Toggle
          checked={prefs.messages}
          onChange={(v) => setPrefs((p) => ({ ...p, messages: v }))}
          label={tr("messages")}
          desc={tr("messages_desc")}
        />
        <Toggle
          checked={prefs.onlyWhenHidden}
          onChange={(v) => setPrefs((p) => ({ ...p, onlyWhenHidden: v }))}
          label={tr("only_hidden")}
          desc={tr("only_hidden_desc")}
        />
        <div>
          <button
            type="button"
            onClick={handleTest}
            disabled={permission !== "granted"}
            className="px-3 py-1.5 text-[10.5px] rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] hover:border-[var(--color-border-glow)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {tr("test")}
          </button>
        </div>
      </div>

      {/* ── Regole posizioni ── */}
      <div className={`${card} mb-4`}>
        <div className="flex items-baseline gap-3 flex-wrap mb-1">
          <h2 className="text-[12px] font-bold tracking-[0.1em] uppercase text-[var(--color-bright)] m-0">
            {tr("rules_title")}
          </h2>
        </div>
        <p className="text-[10.5px] text-[var(--color-muted)] m-0 mb-3">
          {tr("rules_desc")}
        </p>

        {prefs.rules.length === 0 && (
          <p className="text-[11px] text-[var(--color-dim)] m-0 mb-3">
            {tr("empty_rules")}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {prefs.rules.map((r) => (
            <div
              key={r.id}
              className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-card)]"
              style={{ opacity: r.enabled ? 1 : 0.55 }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end mb-3">
                <div>
                  <label className={labelCls}>{tr("rule_name")}</label>
                  <input
                    className={inputCls}
                    value={r.name}
                    maxLength={60}
                    onChange={(e) => updateRule(r.id, { name: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-[10.5px] text-[var(--color-muted)] cursor-pointer pb-1.5">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) =>
                      updateRule(r.id, { enabled: e.target.checked })
                    }
                  />
                  {tr("rule_enabled")}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setPrefs((p) => ({
                      ...p,
                      rules: p.rules.filter((x) => x.id !== r.id),
                    }))
                  }
                  className="pb-1.5 text-[10.5px] text-[var(--color-red)] hover:underline cursor-pointer bg-transparent border-0"
                >
                  {tr("delete")}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className={labelCls}>{tr("trigger")}</label>
                  <select
                    className={inputCls}
                    value={r.trigger}
                    onChange={(e) =>
                      updateRule(r.id, {
                        trigger: e.target.value === "new" ? "new" : "scored",
                      })
                    }
                  >
                    <option value="scored">{tr("trigger_scored")}</option>
                    <option value="new">{tr("trigger_new")}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{tr("min_score")}</label>
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    max={100}
                    disabled={r.trigger === "new"}
                    placeholder={tr("any")}
                    value={r.minScore ?? ""}
                    onChange={(e) =>
                      updateRule(r.id, {
                        minScore:
                          e.target.value === ""
                            ? null
                            : Math.min(
                                100,
                                Math.max(0, Number(e.target.value)),
                              ),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>{tr("work_mode")}</label>
                  <select
                    className={inputCls}
                    value={r.workMode}
                    onChange={(e) =>
                      updateRule(r.id, {
                        workMode: e.target
                          .value as NotificationRule["workMode"],
                      })
                    }
                  >
                    <option value="any">{tr("any")}</option>
                    <option value="remote">{tr("wm_remote")}</option>
                    <option value="hybrid">{tr("wm_hybrid")}</option>
                    <option value="onsite">{tr("wm_onsite")}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{tr("min_count")}</label>
                  <input
                    className={inputCls}
                    type="number"
                    min={1}
                    max={50}
                    value={r.minCount}
                    title={tr("min_count_hint")}
                    onChange={(e) =>
                      updateRule(r.id, {
                        minCount: Math.min(
                          50,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>{tr("locations")}</label>
                  <input
                    className={inputCls}
                    placeholder={tr("locations_hint")}
                    defaultValue={listToText(r.locations)}
                    onBlur={(e) =>
                      updateRule(r.id, {
                        locations: textToList(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>{tr("countries")}</label>
                  <input
                    className={inputCls}
                    placeholder={tr("countries_hint")}
                    defaultValue={listToText(r.countries)}
                    onBlur={(e) =>
                      updateRule(r.id, {
                        countries: textToList(e.target.value).map((c) =>
                          c.toUpperCase(),
                        ),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>{tr("keywords")}</label>
                  <input
                    className={inputCls}
                    placeholder={tr("keywords_hint")}
                    defaultValue={listToText(r.keywords)}
                    onBlur={(e) =>
                      updateRule(r.id, { keywords: textToList(e.target.value) })
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap mt-4">
          <button
            type="button"
            onClick={() =>
              setPrefs((p) => ({ ...p, rules: [...p.rules, newRule()] }))
            }
            className="px-3 py-1.5 text-[10.5px] font-semibold rounded border cursor-pointer transition-colors"
            style={{
              color: "var(--color-green)",
              borderColor: "var(--color-green)",
            }}
          >
            + {tr("add_rule")}
          </button>
          <span className="text-[10px] text-[var(--color-dim)]">
            {tr("presets")}
          </span>
          <button
            type="button"
            onClick={() =>
              setPrefs((p) => ({
                ...p,
                rules: [
                  ...p.rules,
                  newRule({ name: tr("preset_high"), minScore: 80 }),
                ],
              }))
            }
            className="px-2.5 py-1 text-[10px] rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] cursor-pointer transition-colors"
          >
            {tr("preset_high")}
          </button>
          <button
            type="button"
            onClick={() =>
              setPrefs((p) => ({
                ...p,
                rules: [
                  ...p.rules,
                  newRule({
                    name: tr("preset_milano"),
                    minScore: 75,
                    locations: ["Milano"],
                  }),
                ],
              }))
            }
            className="px-2.5 py-1 text-[10px] rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] cursor-pointer transition-colors"
          >
            {tr("preset_milano")}
          </button>
        </div>
      </div>

      {/* ── Salva ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || loggedIn === false}
          className="px-4 py-2 text-[11px] font-bold tracking-[0.08em] uppercase rounded cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
          style={{
            background: "var(--color-green)",
            color: "var(--color-void)",
          }}
        >
          {tr("save")}
        </button>
        {saveState === "ok" && (
          <span className="text-[11px] text-[var(--color-green)]">
            {tr("saved")}
          </span>
        )}
        {saveState === "error" && (
          <span className="text-[11px] text-[var(--color-red)]">
            {tr("save_error")}
          </span>
        )}
      </div>
    </div>
  );
}
