"use client";

// La formula di accettazione sotto i pulsanti di accesso.
//
// Prima non c'era nulla: si arrivava su «Login with Google» senza un
// riferimento ai due documenti, e l'accettazione era del tutto implicita.
//
// Testo inglese di HQ-DOCS (`docs/internal/2026-08-07-LEGAL-COPY-DRAFT.md`,
// microcopy login). Due scelte sue che vanno rispettate anche traducendo:
// si **accettano** i Termini e si **prende atto** della Privacy — sono due
// verbi diversi di proposito, non sinonimi da uniformare. E i due link
// devono essere raggiungibili PRIMA di iniziare l'autenticazione, non dopo:
// per questo stanno qui sotto i pulsanti e non in una pagina successiva.
//
// ⚠️ Il testo è un draft in attesa di approvazione dell'operatore. È
// implementabile perché è microcopy di interfaccia, non una clausola: dice
// dove sono i documenti, non cosa contengono.

import Link from "next/link";

import { useLandingI18n, type Lang } from "./LandingI18n";

/** Le tre parti della frase: prima del link ai Termini, fra i due link,
 *  dopo il link alla Privacy. Spezzata così invece che con un `dangerously`
 *  o un `replace` su segnaposto: i link restano veri elementi, quindi
 *  focalizzabili da tastiera e leggibili da uno screen reader. */
const PARTS: Record<Lang, [string, string, string]> = {
  en: [
    "By continuing with Google, you agree to the ",
    " and acknowledge the ",
    ".",
  ],
  it: ["Continuando con Google, accetti i ", " e prendi atto della ", "."],
  es: [
    "Al continuar con Google, aceptas los ",
    " y declaras haber leído la ",
    ".",
  ],
  fr: [
    "En continuant avec Google, vous acceptez les ",
    " et déclarez avoir pris connaissance de la ",
    ".",
  ],
  de: [
    "Wenn du mit Google fortfährst, stimmst du den ",
    " zu und nimmst die ",
    " zur Kenntnis.",
  ],
  pt: [
    "Ao continuares com a Google, aceitas os ",
    " e declaras ter tomado conhecimento da ",
    ".",
  ],
  hu: [
    "Ha a Google-lel folytatod, elfogadod a következőt: ",
    ", és tudomásul veszed a következőt: ",
    ".",
  ],
};

const TERMS: Record<Lang, string> = {
  en: "Terms of Service",
  it: "Termini di servizio",
  es: "Términos del servicio",
  fr: "Conditions d'utilisation",
  de: "Nutzungsbedingungen",
  pt: "Termos de serviço",
  hu: "Szolgáltatási feltételek",
};

const PRIVACY: Record<Lang, string> = {
  en: "Privacy Policy",
  it: "Informativa sulla privacy",
  es: "Política de privacidad",
  fr: "Politique de confidentialité",
  de: "Datenschutzerklärung",
  pt: "Política de privacidade",
  hu: "Adatvédelmi tájékoztató",
};

export default function LoginAcceptance() {
  const { lang } = useLandingI18n();
  const [before, between, after] = PARTS[lang] ?? PARTS.en;
  const linkClass =
    "text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-green)] transition-colors";

  return (
    <p className="mt-4 text-center text-[11px] leading-relaxed text-[var(--color-dim)]">
      {before}
      <Link href="/terms" className={linkClass}>
        {TERMS[lang] ?? TERMS.en}
      </Link>
      {between}
      <Link href="/privacy" className={linkClass}>
        {PRIVACY[lang] ?? PRIVACY.en}
      </Link>
      {after}
    </p>
  );
}
