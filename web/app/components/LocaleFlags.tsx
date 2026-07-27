/**
 * Bandierine SVG delle sette lingue supportate.
 *
 * Vivevano duplicate nello switcher lingua dell'area protetta e in
 * LandingNav (landing pubblica), e avevano già iniziato a divergere: la
 * sfera armillare del Portogallo era un anello dorato in una copia e un
 * disco giallo pieno nell'altra. Qui esistono una volta sola.
 *
 * Modulo a parte e non dentro un componente di switch lingua perché
 * quello sarebbe un client component con stato e fetch: chi vuole solo
 * le bandierine (la landing, le Impostazioni) non deve tirarselo dietro
 * nel bundle.
 */
function FlagIT() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="7" height="14" fill="#009246" />
      <rect x="7" width="6" height="14" fill="#fff" />
      <rect x="13" width="7" height="14" fill="#CE2B37" />
    </svg>
  );
}

function FlagEN() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="20" height="14" fill="#012169" />
      <path d="M0,0 L20,14 M20,0 L0,14" stroke="#fff" strokeWidth="2.5" />
      <path d="M0,0 L20,14 M20,0 L0,14" stroke="#C8102E" strokeWidth="1.5" />
      <path d="M10,0 V14 M0,7 H20" stroke="#fff" strokeWidth="4" />
      <path d="M10,0 V14 M0,7 H20" stroke="#C8102E" strokeWidth="2.5" />
    </svg>
  );
}

function FlagHU() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="20" height="4.67" fill="#CD2A3E" />
      <rect y="4.67" width="20" height="4.66" fill="#fff" />
      <rect y="9.33" width="20" height="4.67" fill="#436F4D" />
    </svg>
  );
}

function FlagES() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="20" height="14" fill="#AA151B" />
      <rect y="3.5" width="20" height="7" fill="#F1BF00" />
    </svg>
  );
}

function FlagDE() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="20" height="4.67" fill="#000" />
      <rect y="4.67" width="20" height="4.66" fill="#DD0000" />
      <rect y="9.33" width="20" height="4.67" fill="#FFCE00" />
    </svg>
  );
}

function FlagFR() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="6.67" height="14" fill="#0055A4" />
      <rect x="6.67" width="6.66" height="14" fill="#fff" />
      <rect x="13.33" width="6.67" height="14" fill="#EF4135" />
    </svg>
  );
}

function FlagPT() {
  return (
    <svg aria-hidden="true" width="20" height="14" viewBox="0 0 20 14">
      <rect width="8" height="14" fill="#006600" />
      <rect x="8" width="12" height="14" fill="#FF0000" />
      <circle
        cx="8"
        cy="7"
        r="2.4"
        fill="none"
        stroke="#FFD700"
        strokeWidth="1"
      />
    </svg>
  );
}

/** Bandierina per codice locale. */
export const FLAGS: Record<string, () => React.JSX.Element> = {
  it: FlagIT,
  en: FlagEN,
  hu: FlagHU,
  es: FlagES,
  de: FlagDE,
  fr: FlagFR,
  pt: FlagPT,
};
