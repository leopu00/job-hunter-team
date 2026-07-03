"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; tokenName: string; tokenPrefix: string }
  | { kind: "error"; message: string };

const CODE_RE = /^[A-Z]{4}-?\d{4}$/;

// Dict inline stile TicketPanel: le frasi spezzate da <code>/<a> sono divise
// in coppie Before/After così ogni lingua mantiene il proprio ordine di parole.
const T: Record<
  Locale,
  {
    errMalformed: string;
    errHttp: string; // {status}
    errNetwork: string;
    successTitle: string;
    successBody1: string; // prima di <code>jht cloud login</code>
    successBody2: string; // dopo
    tokenLabel: string;
    prefixLabel: string;
    manageTokens: string; // prima del link /settings/cloud-sync
    pageTitle: string;
    introBefore: string; // prima di <code>jht cloud login</code>
    introAfter: string;
    codeLabel: string;
    codeHint: string;
    tokenNameLabel: string;
    optional: string;
    tokenNamePlaceholder: string;
    tokenNameHint: string;
    submitting: string;
    submit: string;
    detailsSummary: string;
    li1Before: string; // prima di <code>jht_sync_…</code>
    li1After: string;
    li2: string;
    li3: string;
    li4Before: string; // prima del link /settings/cloud-sync
    li4After: string; // dopo il link (include il separatore)
  }
> = {
  it: {
    errMalformed: "Codice malformato. Atteso formato AAAA-1234.",
    errHttp: "Errore HTTP {status}",
    errNetwork: "Errore di rete",
    successTitle: "Pairing completato",
    successBody1:
      "Il tuo VPS o PC ora è collegato a questo account. Torna al terminale —",
    successBody2: "completerà il setup automaticamente.",
    tokenLabel: "Token:",
    prefixLabel: "Prefisso:",
    manageTokens: "Puoi gestire o revocare i token su",
    pageTitle: "Connetti il CLI",
    introBefore: "Stai facendo",
    introAfter:
      "da un VPS o PC? Il terminale ti ha mostrato un codice — digitalo qui per completare il pairing.",
    codeLabel: "Codice dal terminale",
    codeHint:
      "Formato: 4 lettere + 4 numeri (es. ABCD-1234). Il trattino è opzionale.",
    tokenNameLabel: "Nome del token",
    optional: "(opzionale)",
    tokenNamePlaceholder: "vps-marco / casa-pc / …",
    tokenNameHint:
      "Identifica questo dispositivo nei tuoi token. Puoi rinominarlo dopo.",
    submitting: "Confermo…",
    submit: "Conferma pairing",
    detailsSummary: "Cosa succede dopo?",
    li1Before: "Generiamo un token",
    li1After: "nel tuo account.",
    li2: "Lo associamo al codice che hai digitato.",
    li3: "Il terminale (CLI) lo riceverà al prossimo poll (entro pochi secondi).",
    li4Before: "Il token resta consultabile su",
    li4After: "; puoi revocarlo lì in qualsiasi momento.",
  },
  en: {
    errMalformed: "Malformed code. Expected format: AAAA-1234.",
    errHttp: "HTTP error {status}",
    errNetwork: "Network error",
    successTitle: "Pairing complete",
    successBody1:
      "Your VPS or PC is now linked to this account. Go back to the terminal —",
    successBody2: "will finish the setup automatically.",
    tokenLabel: "Token:",
    prefixLabel: "Prefix:",
    manageTokens: "You can manage or revoke tokens at",
    pageTitle: "Connect the CLI",
    introBefore: "Running",
    introAfter:
      "on a VPS or PC? The terminal showed you a code — type it here to complete pairing.",
    codeLabel: "Code from the terminal",
    codeHint:
      "Format: 4 letters + 4 digits (e.g. ABCD-1234). The dash is optional.",
    tokenNameLabel: "Token name",
    optional: "(optional)",
    tokenNamePlaceholder: "vps-mark / home-pc / …",
    tokenNameHint:
      "Identifies this device among your tokens. You can rename it later.",
    submitting: "Confirming…",
    submit: "Confirm pairing",
    detailsSummary: "What happens next?",
    li1Before: "We generate a",
    li1After: "token in your account.",
    li2: "We link it to the code you typed.",
    li3: "The terminal (CLI) will receive it on the next poll (within a few seconds).",
    li4Before: "The token stays visible at",
    li4After: "; you can revoke it there at any time.",
  },
  es: {
    errMalformed: "Código mal formado. Formato esperado: AAAA-1234.",
    errHttp: "Error HTTP {status}",
    errNetwork: "Error de red",
    successTitle: "Emparejamiento completado",
    successBody1:
      "Tu VPS o PC ya está vinculado a esta cuenta. Vuelve a la terminal —",
    successBody2: "completará la configuración automáticamente.",
    tokenLabel: "Token:",
    prefixLabel: "Prefijo:",
    manageTokens: "Puedes gestionar o revocar los tokens en",
    pageTitle: "Conecta la CLI",
    introBefore: "¿Estás ejecutando",
    introAfter:
      "desde un VPS o PC? La terminal te mostró un código — escríbelo aquí para completar el emparejamiento.",
    codeLabel: "Código de la terminal",
    codeHint:
      "Formato: 4 letras + 4 números (p. ej. ABCD-1234). El guion es opcional.",
    tokenNameLabel: "Nombre del token",
    optional: "(opcional)",
    tokenNamePlaceholder: "vps-marcos / pc-casa / …",
    tokenNameHint:
      "Identifica este dispositivo entre tus tokens. Puedes renombrarlo después.",
    submitting: "Confirmando…",
    submit: "Confirmar emparejamiento",
    detailsSummary: "¿Qué pasa después?",
    li1Before: "Generamos un token",
    li1After: "en tu cuenta.",
    li2: "Lo asociamos al código que escribiste.",
    li3: "La terminal (CLI) lo recibirá en el próximo poll (en pocos segundos).",
    li4Before: "El token queda visible en",
    li4After: "; puedes revocarlo ahí en cualquier momento.",
  },
  fr: {
    errMalformed: "Code mal formé. Format attendu : AAAA-1234.",
    errHttp: "Erreur HTTP {status}",
    errNetwork: "Erreur réseau",
    successTitle: "Appairage terminé",
    successBody1:
      "Votre VPS ou PC est maintenant relié à ce compte. Retournez au terminal —",
    successBody2: "terminera la configuration automatiquement.",
    tokenLabel: "Token :",
    prefixLabel: "Préfixe :",
    manageTokens: "Vous pouvez gérer ou révoquer les tokens sur",
    pageTitle: "Connecter la CLI",
    introBefore: "Vous lancez",
    introAfter:
      "depuis un VPS ou un PC ? Le terminal vous a affiché un code — saisissez-le ici pour terminer l'appairage.",
    codeLabel: "Code du terminal",
    codeHint:
      "Format : 4 lettres + 4 chiffres (ex. ABCD-1234). Le tiret est facultatif.",
    tokenNameLabel: "Nom du token",
    optional: "(facultatif)",
    tokenNamePlaceholder: "vps-marc / pc-maison / …",
    tokenNameHint:
      "Identifie cet appareil parmi vos tokens. Vous pourrez le renommer plus tard.",
    submitting: "Confirmation…",
    submit: "Confirmer l'appairage",
    detailsSummary: "Que se passe-t-il ensuite ?",
    li1Before: "Nous générons un token",
    li1After: "dans votre compte.",
    li2: "Nous l'associons au code que vous avez saisi.",
    li3: "Le terminal (CLI) le recevra au prochain poll (en quelques secondes).",
    li4Before: "Le token reste consultable sur",
    li4After: " ; vous pouvez le révoquer là à tout moment.",
  },
  de: {
    errMalformed: "Ungültiger Code. Erwartetes Format: AAAA-1234.",
    errHttp: "HTTP-Fehler {status}",
    errNetwork: "Netzwerkfehler",
    successTitle: "Kopplung abgeschlossen",
    successBody1:
      "Dein VPS oder PC ist jetzt mit diesem Konto verbunden. Geh zurück zum Terminal —",
    successBody2: "schließt das Setup automatisch ab.",
    tokenLabel: "Token:",
    prefixLabel: "Präfix:",
    manageTokens: "Tokens verwalten oder widerrufen kannst du unter",
    pageTitle: "CLI verbinden",
    introBefore: "Du führst gerade",
    introAfter:
      "auf einem VPS oder PC aus? Das Terminal hat dir einen Code angezeigt — gib ihn hier ein, um die Kopplung abzuschließen.",
    codeLabel: "Code aus dem Terminal",
    codeHint:
      "Format: 4 Buchstaben + 4 Ziffern (z. B. ABCD-1234). Der Bindestrich ist optional.",
    tokenNameLabel: "Token-Name",
    optional: "(optional)",
    tokenNamePlaceholder: "vps-markus / heim-pc / …",
    tokenNameHint:
      "Identifiziert dieses Gerät in deinen Tokens. Du kannst den Namen später ändern.",
    submitting: "Wird bestätigt…",
    submit: "Kopplung bestätigen",
    detailsSummary: "Was passiert danach?",
    li1Before: "Wir erstellen einen Token",
    li1After: "in deinem Konto.",
    li2: "Wir verknüpfen ihn mit dem Code, den du eingegeben hast.",
    li3: "Das Terminal (CLI) erhält ihn beim nächsten Poll (innerhalb weniger Sekunden).",
    li4Before: "Der Token bleibt einsehbar unter",
    li4After: "; dort kannst du ihn jederzeit widerrufen.",
  },
  hu: {
    errMalformed: "Hibás formátumú kód. Elvárt formátum: AAAA-1234.",
    errHttp: "HTTP {status} hiba",
    errNetwork: "Hálózati hiba",
    successTitle: "Párosítás kész",
    successBody1:
      "A VPS-ed vagy PC-d mostantól ehhez a fiókhoz kapcsolódik. Térj vissza a terminálba — a",
    successBody2: "automatikusan befejezi a beállítást.",
    tokenLabel: "Token:",
    prefixLabel: "Előtag:",
    manageTokens: "A tokenjeidet itt kezelheted és vonhatod vissza:",
    pageTitle: "A CLI csatlakoztatása",
    introBefore: "Épp a",
    introAfter:
      "parancsot futtatod egy VPS-en vagy PC-n? A terminál mutatott egy kódot — írd be ide a párosítás befejezéséhez.",
    codeLabel: "Kód a terminálból",
    codeHint:
      "Formátum: 4 betű + 4 szám (pl. ABCD-1234). A kötőjel elhagyható.",
    tokenNameLabel: "A token neve",
    optional: "(nem kötelező)",
    tokenNamePlaceholder: "vps-marci / otthoni-pc / …",
    tokenNameHint:
      "Ez azonosítja az eszközt a tokenjeid között. Később átnevezheted.",
    submitting: "Megerősítés…",
    submit: "Párosítás megerősítése",
    detailsSummary: "Mi történik ezután?",
    li1Before: "Létrehozunk egy",
    li1After: "tokent a fiókodban.",
    li2: "Hozzárendeljük a beírt kódhoz.",
    li3: "A terminál (CLI) a következő pollnál kapja meg (néhány másodpercen belül).",
    li4Before: "A token továbbra is megtekinthető itt:",
    li4After: "; ott bármikor visszavonhatod.",
  },
  pt: {
    errMalformed: "Código mal formado. Formato esperado: AAAA-1234.",
    errHttp: "Erro HTTP {status}",
    errNetwork: "Erro de rede",
    successTitle: "Emparelhamento concluído",
    successBody1:
      "O teu VPS ou PC está agora ligado a esta conta. Volta ao terminal — o",
    successBody2: "concluirá a configuração automaticamente.",
    tokenLabel: "Token:",
    prefixLabel: "Prefixo:",
    manageTokens: "Podes gerir ou revogar os tokens em",
    pageTitle: "Ligar a CLI",
    introBefore: "Estás a executar",
    introAfter:
      "num VPS ou PC? O terminal mostrou-te um código — escreve-o aqui para concluir o emparelhamento.",
    codeLabel: "Código do terminal",
    codeHint:
      "Formato: 4 letras + 4 números (ex. ABCD-1234). O hífen é opcional.",
    tokenNameLabel: "Nome do token",
    optional: "(opcional)",
    tokenNamePlaceholder: "vps-marco / pc-casa / …",
    tokenNameHint:
      "Identifica este dispositivo entre os teus tokens. Podes renomeá-lo depois.",
    submitting: "A confirmar…",
    submit: "Confirmar emparelhamento",
    detailsSummary: "O que acontece a seguir?",
    li1Before: "Geramos um token",
    li1After: "na tua conta.",
    li2: "Associamo-lo ao código que digitaste.",
    li3: "O terminal (CLI) vai recebê-lo no próximo poll (dentro de poucos segundos).",
    li4Before: "O token fica visível em",
    li4After: "; podes revogá-lo aí a qualquer momento.",
  },
};

function normalizeForDisplay(raw: string): string {
  // Accetta input parziali, mostra in formato AAAA-1234. Aggiunge il dash
  // automaticamente quando l'utente ha digitato 4 lettere.
  const cleaned = raw.replace(/[\s\-_]/g, "").toUpperCase();
  if (cleaned.length <= 4) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

export default function CliLinkClient() {
  const t = T[useLocale()];
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
        message: t.errMalformed,
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
          message:
            body.error || t.errHttp.replace("{status}", String(res.status)),
        });
        return;
      }
      setState({
        kind: "success",
        tokenName: body.token_name ?? tokenName,
        tokenPrefix: body.token_prefix ?? "",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t.errNetwork;
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
                {t.successTitle}
              </h1>
              <p className="mt-2 text-sm text-green-800 dark:text-green-200">
                {t.successBody1}
                <code className="mx-1 rounded bg-green-100 px-1 py-0.5 font-mono text-xs dark:bg-green-900">
                  jht cloud login
                </code>
                {t.successBody2}
              </p>
              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-green-700 dark:text-green-300">
                    {t.tokenLabel}
                  </dt>
                  <dd className="font-medium text-green-900 dark:text-green-100">
                    {state.tokenName}
                  </dd>
                </div>
                {state.tokenPrefix && (
                  <div className="flex gap-2">
                    <dt className="text-green-700 dark:text-green-300">
                      {t.prefixLabel}
                    </dt>
                    <dd className="font-mono text-xs text-green-900 dark:text-green-100">
                      {state.tokenPrefix}…
                    </dd>
                  </div>
                )}
              </dl>
              <p className="mt-4 text-xs text-green-700 dark:text-green-400">
                {t.manageTokens}{" "}
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
      <h1 className="text-2xl font-semibold">{t.pageTitle}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {t.introBefore}{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800">
          jht cloud login
        </code>{" "}
        {t.introAfter}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="code" className="block text-sm font-medium">
            {t.codeLabel}
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
            {t.codeHint}
          </p>
        </div>

        <div>
          <label htmlFor="token_name" className="block text-sm font-medium">
            {t.tokenNameLabel}{" "}
            <span className="text-zinc-500">{t.optional}</span>
          </label>
          <input
            id="token_name"
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder={t.tokenNamePlaceholder}
            maxLength={100}
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t.tokenNameHint}
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
          {state.kind === "submitting" ? t.submitting : t.submit}
        </button>
      </form>

      <details className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer font-medium">
          {t.detailsSummary}
        </summary>
        <ol className="mt-3 list-decimal space-y-1 pl-6 text-xs">
          <li>
            {t.li1Before} <code className="font-mono">jht_sync_…</code>{" "}
            {t.li1After}
          </li>
          <li>{t.li2}</li>
          <li>{t.li3}</li>
          <li>
            {t.li4Before}{" "}
            <a href="/settings/cloud-sync" className="underline">
              /settings/cloud-sync
            </a>
            {t.li4After}
          </li>
        </ol>
      </details>
    </div>
  );
}
