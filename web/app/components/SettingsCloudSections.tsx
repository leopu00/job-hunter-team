"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { FLAGS } from "@/app/components/LocaleFlags";
import { localeLabels, type Locale } from "@/i18n/config";
import { useLocale } from "@/lib/use-locale";
import { AVAILABLE_CURRENCIES, currencySymbol } from "@/lib/exchange-rates";
import { DISPLAY_CURRENCY_COOKIE } from "@/lib/display-currency";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  account: {
    it: "Account",
    en: "Account",
    hu: "Fiók",
    es: "Cuenta",
    de: "Konto",
    fr: "Compte",
    pt: "Conta",
  },
  signed_in_with: {
    it: "Accesso con {provider}",
    en: "Signed in with {provider}",
    hu: "Bejelentkezve: {provider}",
    es: "Sesión iniciada con {provider}",
    de: "Angemeldet mit {provider}",
    fr: "Connecté avec {provider}",
    pt: "Sessão iniciada com {provider}",
  },
  logout: {
    it: "Esci",
    en: "Sign out",
    hu: "Kijelentkezés",
    es: "Cerrar sesión",
    de: "Abmelden",
    fr: "Se déconnecter",
    pt: "Sair",
  },
  language: {
    it: "Lingua",
    en: "Language",
    hu: "Nyelv",
    es: "Idioma",
    de: "Sprache",
    fr: "Langue",
    pt: "Idioma",
  },
  currency: {
    it: "Valuta stipendi",
    en: "Salary currency",
    hu: "Fizetés pénzneme",
    es: "Moneda de salarios",
    de: "Gehaltswährung",
    fr: "Devise des salaires",
    pt: "Moeda dos salários",
  },
  currency_hint: {
    it: "Le stime di stipendio in liste, swipe e dettaglio vengono convertite in questa valuta.",
    en: "Salary estimates in lists, swipe and detail are converted to this currency.",
    hu: "A listákban, a lapozóban és a részleteknél a fizetésbecslések erre a pénznemre lesznek átváltva.",
    es: "Las estimaciones salariales en listas, swipe y detalle se convierten a esta moneda.",
    de: "Gehaltsschätzungen in Listen, Swipe und Detail werden in diese Währung umgerechnet.",
    fr: "Les estimations de salaire dans les listes, le swipe et le détail sont converties dans cette devise.",
    pt: "As estimativas salariais em listas, swipe e detalhe são convertidas para esta moeda.",
  },
  connect_title: {
    it: "Collega il tuo team",
    en: "Connect your team",
    hu: "Kapcsold össze a csapatodat",
    es: "Conecta tu equipo",
    de: "Team verbinden",
    fr: "Connecter votre équipe",
    pt: "Liga a tua equipa",
  },
  connect_desc: {
    it: "Questo account non riceve ancora dati. Genera un token dispositivo e inseriscilo nell'app desktop: la dashboard si popolerà da sola.",
    en: "This account doesn't receive data yet. Generate a device token and enter it in the desktop app: the dashboard will fill up by itself.",
    hu: "Ez a fiók még nem kap adatokat. Generálj eszköztokent és add meg az asztali appban: a dashboard magától feltöltődik.",
    es: "Esta cuenta aún no recibe datos. Genera un token de dispositivo e introdúcelo en la app de escritorio: el dashboard se llenará solo.",
    de: "Dieses Konto empfängt noch keine Daten. Erzeuge ein Gerätetoken und gib es in der Desktop-App ein: Das Dashboard füllt sich von selbst.",
    fr: "Ce compte ne reçoit pas encore de données. Générez un token d'appareil et saisissez-le dans l'app desktop : le dashboard se remplira tout seul.",
    pt: "Esta conta ainda não recebe dados. Gera um token de dispositivo e insere-o na app desktop: o dashboard preenche-se sozinho.",
  },
  connect_guide: {
    it: "Guida rapida",
    en: "Quick guide",
    hu: "Gyors útmutató",
    es: "Guía rápida",
    de: "Kurzanleitung",
    fr: "Guide rapide",
    pt: "Guia rápido",
  },
  connect_tokens: {
    it: "Token dispositivi",
    en: "Device tokens",
    hu: "Eszköztokenek",
    es: "Tokens de dispositivo",
    de: "Gerätetokens",
    fr: "Tokens d'appareil",
    pt: "Tokens de dispositivo",
  },
};

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

const card: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  background: "var(--color-card)",
};

/** [JHT-WEB-DEMO] Card promemoria pairing: visibile finché l'account non
 *  riceve dati sincronizzati (GET /api/demo → synced). Sparisce da sola
 *  al primo sync del team. */
export function ConnectTeamCard() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [needsPairing, setNeedsPairing] = useState(false);

  useEffect(() => {
    fetch("/api/demo")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.synced === false) setNeedsPairing(true);
      })
      .catch(() => {});
  }, []);

  if (!needsPairing) return null;

  return (
    <section
      className="rounded-lg p-4"
      style={{
        border:
          "1px solid color-mix(in srgb, var(--color-green) 40%, transparent)",
        background: "var(--color-card)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--color-green)" }}
        />
        <p
          className="m-0 text-[11px] font-bold"
          style={{ color: "var(--color-green)" }}
        >
          {tr("connect_title")}
        </p>
      </div>
      <p
        className="m-0 mb-3 text-[11px]"
        style={{ color: "var(--color-muted)" }}
      >
        {tr("connect_desc")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/welcome"
          className="text-[10px] font-semibold tracking-[0.08em] uppercase no-underline px-2.5 py-1 rounded border transition-colors"
          style={{
            color: "var(--color-green)",
            borderColor:
              "color-mix(in srgb, var(--color-green) 45%, transparent)",
          }}
        >
          {tr("connect_guide")}
        </a>
        <a
          href="/settings/cloud-sync"
          className="text-[10px] font-semibold tracking-[0.08em] uppercase no-underline px-2.5 py-1 rounded border border-[var(--color-border)] transition-colors"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("connect_tokens")}
        </a>
      </div>
    </section>
  );
}

/** Card Account: con che utente sei dentro + Esci. */
export function AccountCard() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const router = useRouter();
  const [user, setUser] = useState<{
    email: string;
    name: string | null;
    avatar: string | null;
    provider: string | null;
  } | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }: { data: { user: SupabaseUser | null } }) => {
        const u = data.user;
        if (!u) return;
        setUser({
          email: u.email ?? "",
          name: (u.user_metadata?.full_name as string) ?? null,
          avatar: (u.user_metadata?.avatar_url as string) ?? null,
          provider: (u.app_metadata?.provider as string) ?? null,
        });
      });
  }, []);

  if (!user) return null;

  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();
  // "google" → "Google": il provider arriva in minuscolo da Supabase.
  const provider = user.provider
    ? user.provider.charAt(0).toUpperCase() + user.provider.slice(1)
    : null;

  const logout = async () => {
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <div className="rounded-lg px-4 py-4" style={card}>
      <p
        className="m-0 mb-3 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: "var(--color-dim)" }}
      >
        {tr("account")}
      </p>
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-full overflow-hidden border flex items-center justify-center flex-shrink-0"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-panel)",
          }}
        >
          {user.avatar ? (
            <Image
              src={user.avatar}
              alt=""
              width={44}
              height={44}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-[13px] font-bold text-[var(--color-green)]">
              {initials}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="m-0 text-[13px] font-semibold truncate"
            style={{ color: "var(--color-bright)" }}
          >
            {user.name ?? user.email.split("@")[0]}
          </p>
          <p
            className="m-0 text-[11px] truncate"
            style={{ color: "var(--color-muted)" }}
          >
            {user.email}
          </p>
          {provider && (
            <p
              className="m-0 text-[10px]"
              style={{ color: "var(--color-dim)" }}
            >
              {tr("signed_in_with").replace("{provider}", provider)}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={logout}
        className="mt-4 w-full rounded-lg border px-3 py-2.5 text-[11px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
        style={{
          borderColor: "color-mix(in srgb, var(--color-red) 40%, transparent)",
          color: "var(--color-red)",
          background: "transparent",
        }}
      >
        {tr("logout")}
      </button>
    </div>
  );
}

/** Riga Lingua: stesse bandierine e stessa persistenza della navbar. */
export function LanguageCard() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [busy, setBusy] = useState(false);

  const switchLocale = async (code: Locale) => {
    if (busy || code === locale) return;
    setBusy(true);
    const res = await fetch("/api/i18n", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: code }),
    }).catch(() => null);
    if (res?.ok) {
      // Tiene in sync la landing, che legge la lingua da localStorage.
      try {
        localStorage.setItem("jht-lang", code);
      } catch {
        /* localStorage non disponibile */
      }
      window.location.reload();
    } else {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg px-4 py-4" style={card}>
      <p
        className="m-0 mb-3 text-[11px] font-semibold"
        style={{ color: "var(--color-muted)" }}
      >
        {tr("language")}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {(Object.keys(localeLabels) as Locale[]).map((code) => {
          const Flag = FLAGS[code];
          const on = code === locale;
          return (
            <button
              key={code}
              type="button"
              onClick={() => switchLocale(code)}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold cursor-pointer transition-colors"
              style={{
                borderColor: on ? "var(--color-green)" : "var(--color-border)",
                color: on ? "var(--color-bright)" : "var(--color-muted)",
                background: on ? "rgba(0,232,122,0.08)" : "transparent",
              }}
            >
              {Flag && <Flag />}
              {localeLabels[code]?.label ?? code}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Riga Valuta stipendi: scrive il cookie letto dalle pagine server. */
export function CurrencyCard() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [cur, setCur] = useState<string>("EUR");

  useEffect(() => {
    const c = readCookie(DISPLAY_CURRENCY_COOKIE);
    if (c) setCur(c.toUpperCase());
  }, []);

  const pick = (code: string) => {
    setCur(code);
    document.cookie = `${DISPLAY_CURRENCY_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div className="rounded-lg px-4 py-4" style={card}>
      <div className="flex items-center justify-between gap-4">
        <p
          className="m-0 text-[11px] font-semibold"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("currency")}
        </p>
        <select
          value={cur}
          onChange={(e) => pick(e.target.value)}
          aria-label={tr("currency")}
          className="rounded-lg border px-2 py-1.5 text-[11px] font-semibold"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-panel)",
            color: "var(--color-bright)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {AVAILABLE_CURRENCIES.map((c) => {
            // Simbolo davanti a codice e nome ("€ EUR — Euro"); per le
            // valute senza simbolo univoco currencySymbol torna il codice
            // stesso → lo omettiamo per non doppiare ("CHF CHF").
            const sym = currencySymbol(c.code).trim();
            const pre = sym !== c.code ? `${sym} ` : "";
            return (
              <option key={c.code} value={c.code}>
                {pre}
                {c.code} — {c.name}
              </option>
            );
          })}
        </select>
      </div>
      <p className="m-0 mt-2 text-[10px]" style={{ color: "var(--color-dim)" }}>
        {tr("currency_hint")}
      </p>
    </div>
  );
}
