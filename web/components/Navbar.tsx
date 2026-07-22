import Link from "next/link";
import dynamic from "next/dynamic";
import type { User } from "@supabase/supabase-js";
import { type Locale } from "@/i18n/config";
import LoginButton from "./LoginButton";
import NavLinks from "./NavLinks";
import NavbarMobile from "./NavbarMobile";
import UserMenu from "./UserMenu";

const MessagesDrawer = dynamic(() => import("@/app/components/MessagesDrawer"));
// [JHT-WEB-NOTIFICATIONS] agente invisibile: notifiche browser da eventi Realtime
const WebNotificationsAgent = dynamic(
  () => import("@/app/hooks/useWebNotifications"),
);

const T: Record<Locale, { navAria: string }> = {
  it: { navAria: "Navigazione app" },
  en: { navAria: "App navigation" },
  es: { navAria: "Navegación de la app" },
  fr: { navAria: "Navigation de l'application" },
  de: { navAria: "App-Navigation" },
  hu: { navAria: "Alkalmazás navigáció" },
  pt: { navAria: "Navegação da app" },
};

interface NavbarProps {
  user: User | null;
  locale: Locale;
  // [JHT-WEB-DEMO] true = nessun dato sincronizzato → lo UserMenu mostra
  // il promemoria "Collega il tuo team" (con pallino sull'avatar).
  needsPairing?: boolean;
}

export default function Navbar({ user, locale, needsPairing }: NavbarProps) {
  const t = T[locale];

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const fullName = user?.user_metadata?.full_name as string | undefined;
  const email = user?.email ?? "";

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
      <nav
        aria-label={t.navAria}
        className="px-5 sm:px-6 h-14 flex items-center gap-4"
      >
        {/* Brand */}
        <Link
          href="/dashboard"
          className="flex items-center no-underline group flex-shrink-0"
        >
          <span className="text-[13px] font-bold tracking-widest text-[var(--color-white)] group-hover:opacity-80 transition-opacity">
            JHT
          </span>
        </Link>

        {/* Nav links (desktop) — in flow, centrati con mx-auto cosi` su
            viewport stretto non finiscono mai sopra logo o controlli a
            destra (col vecchio `absolute left-1/2` succedeva). */}
        <div className="hidden md:flex items-center mx-auto">
          <NavLinks />
        </div>

        {/* Mobile hamburger */}
        <NavbarMobile />

        {/* User / Login. Niente selettore lingua qui (20/07): la lingua
            vive in Impostazioni → Lingua. */}
        {user ? (
          <div className="flex items-center gap-3 flex-shrink-0 ml-auto md:ml-0">
            <WebNotificationsAgent />
            <MessagesDrawer />
            <UserMenu
              avatarUrl={avatarUrl}
              fullName={fullName}
              email={email}
              needsPairing={needsPairing}
            />
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-shrink-0 ml-auto md:ml-0">
            <MessagesDrawer />
            <LoginButton />
          </div>
        )}
      </nav>
    </header>
  );
}
