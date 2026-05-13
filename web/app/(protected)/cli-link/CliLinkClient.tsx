"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; tokenName: string; tokenPrefix: string }
  | { kind: "error"; message: string };

const CODE_RE = /^[A-Z]{4}-?\d{4}$/;

function normalizeForDisplay(raw: string): string {
  // Accetta input parziali, mostra in formato AAAA-1234. Aggiunge il dash
  // automaticamente quando l'utente ha digitato 4 lettere.
  const cleaned = raw.replace(/[\s\-_]/g, "").toUpperCase();
  if (cleaned.length <= 4) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

export default function CliLinkClient() {
  const params = useSearchParams();
  const initialCode = params?.get("code") ?? "";
  const [code, setCode] = useState(normalizeForDisplay(initialCode));
  const [tokenName, setTokenName] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  // Pre-popola il name di default usando un suggerimento utile
  useEffect(() => {
    if (!tokenName) {
      const today = new Date().toISOString().slice(0, 10);
      setTokenName(`cli-${today}`);
    }
  }, [tokenName]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!CODE_RE.test(code)) {
      setState({
        kind: "error",
        message: "Codice malformato. Atteso formato AAAA-1234.",
      });
      return;
    }

    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/cloud-sync/device-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_code: code,
          token_name: tokenName.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          kind: "error",
          message: body.error || `Errore HTTP ${res.status}`,
        });
        return;
      }
      setState({
        kind: "success",
        tokenName: body.token_name ?? tokenName,
        tokenPrefix: body.token_prefix ?? "",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Errore di rete";
      setState({ kind: "error", message });
    }
  }

  if (state.kind === "success") {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950">
          <div className="flex items-start gap-3">
            <div className="text-2xl">✓</div>
            <div>
              <h1 className="text-xl font-semibold text-green-900 dark:text-green-100">
                Pairing completato
              </h1>
              <p className="mt-2 text-sm text-green-800 dark:text-green-200">
                Il tuo VPS o PC ora è collegato a questo account. Torna al
                terminale —
                <code className="mx-1 rounded bg-green-100 px-1 py-0.5 font-mono text-xs dark:bg-green-900">
                  jht cloud login
                </code>
                completerà il setup automaticamente.
              </p>
              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-green-700 dark:text-green-300">Token:</dt>
                  <dd className="font-medium text-green-900 dark:text-green-100">
                    {state.tokenName}
                  </dd>
                </div>
                {state.tokenPrefix && (
                  <div className="flex gap-2">
                    <dt className="text-green-700 dark:text-green-300">
                      Prefisso:
                    </dt>
                    <dd className="font-mono text-xs text-green-900 dark:text-green-100">
                      {state.tokenPrefix}…
                    </dd>
                  </div>
                )}
              </dl>
              <p className="mt-4 text-xs text-green-700 dark:text-green-400">
                Puoi gestire o revocare i token su{" "}
                <a href="/settings/cloud-sync" className="underline">
                  /settings/cloud-sync
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Connetti il CLI</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Stai facendo{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800">
          jht cloud login
        </code>{" "}
        da un VPS o PC? Il terminale ti ha mostrato un codice — digitalo qui per
        completare il pairing.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="code" className="block text-sm font-medium">
            Codice dal terminale
          </label>
          <input
            id="code"
            type="text"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            value={code}
            onChange={(e) => setCode(normalizeForDisplay(e.target.value))}
            placeholder="AAAA-1234"
            maxLength={9}
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-lg uppercase tracking-widest shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Formato: 4 lettere + 4 numeri (es. ABCD-1234). Il dash è opzionale.
          </p>
        </div>

        <div>
          <label htmlFor="token_name" className="block text-sm font-medium">
            Nome del token <span className="text-zinc-500">(opzionale)</span>
          </label>
          <input
            id="token_name"
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="vps-marco / casa-pc / …"
            maxLength={100}
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Identifica questo dispositivo nei tuoi token. Puoi rinominarlo dopo.
          </p>
        </div>

        {state.kind === "error" && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {state.message}
          </div>
        )}

        <button
          type="submit"
          disabled={state.kind === "submitting" || !CODE_RE.test(code)}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === "submitting" ? "Confermo…" : "Conferma pairing"}
        </button>
      </form>

      <details className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer font-medium">
          Cosa succede dopo?
        </summary>
        <ol className="mt-3 list-decimal space-y-1 pl-6 text-xs">
          <li>
            Generiamo un token <code className="font-mono">jht_sync_…</code> nel
            tuo account.
          </li>
          <li>Lo associamo al codice che hai digitato.</li>
          <li>
            Il terminale (CLI) lo riceverà al prossimo poll (entro pochi
            secondi).
          </li>
          <li>
            Il token resta consultabile su{" "}
            <a href="/settings/cloud-sync" className="underline">
              /settings/cloud-sync
            </a>
            ; puoi revocarlo lì in qualsiasi momento.
          </li>
        </ol>
      </details>
    </div>
  );
}
