"use client";

import { LandingI18nProvider } from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";
import DocsSidebar from "./DocsSidebar";

// Shared chrome for the whole /docs section: site nav + a left sidebar that
// lists every guide + footer. Each docs page only renders its own content.
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LandingI18nProvider>
      <ScrollToTop />
      <main style={{ position: "relative", zIndex: 1 }}>
        <LandingNav />
        <DocsSidebar />
        <div className="md:pl-[21rem]">
          <div className="max-w-3xl mx-auto min-w-0 px-6 md:px-12 pt-32 pb-20">
            {children}
          </div>
        </div>
      </main>
      <LandingFooter />
    </LandingI18nProvider>
  );
}
