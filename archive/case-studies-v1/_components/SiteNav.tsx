"use client";

// Header globale del sito riusato sulla pagina /case-studies.
// LandingNav è un client component che legge il contesto i18n, quindi va
// avvolto nel suo provider (la pagina case-studies è un server component
// e non lo fornisce). La nav è `fixed`: la pagina compensa con uno
// spacer e sposta lo sticky delle tab sotto di essa.
import { LandingI18nProvider } from "../../components/landing/LandingI18n";
import LandingNav from "../../components/landing/LandingNav";

export default function SiteNav() {
  return (
    <LandingI18nProvider>
      <LandingNav />
    </LandingI18nProvider>
  );
}
