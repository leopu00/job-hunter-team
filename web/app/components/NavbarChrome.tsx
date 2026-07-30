"use client";

import type { User } from "@supabase/supabase-js";
import { type Locale } from "@/i18n/config";
import { isLocalDeploy } from "@/lib/deploy-mode";
import Navbar from "./Navbar";

interface Props {
  user: User | null;
  locale: Locale;
  needsPairing?: boolean;
}

export default function NavbarChrome(props: Props) {
  // [JHT-DASHBOARD-SPLIT] Sul container LOCAL la dashboard vive embedded
  // nell'app desktop, che ha già la propria sidebar/chrome: la navbar web
  // (logo + nav + login) è ridondante e dà la sensazione "pagina-in-pagina".
  // Su cloud (browser) resta.
  if (isLocalDeploy()) return null;
  return <Navbar {...props} />;
}
