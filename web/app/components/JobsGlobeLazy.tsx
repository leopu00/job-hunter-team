"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import GlobePlaceholder from "./GlobePlaceholder";

// Wrapper Client che fa il dynamic import di JobsGlobe (maplibre-gl
// ~1 MB parsed). ssr:false perche' il canvas WebGL non ha senso lato
// server. Finche' il pezzo non c'e' il suo posto non resta vuoto: il segnaposto.
// Vedi docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md insight #10
// e la nota in app/(protected)/dashboard/page.tsx riga 18.
const JobsGlobe = dynamic(() => import("@/app/components/JobsGlobe"), {
  ssr: false,
  loading: () => <GlobePlaceholder />,
});

type JobsGlobeProps = ComponentProps<typeof JobsGlobe>;

export default function JobsGlobeLazy(props: JobsGlobeProps) {
  return <JobsGlobe {...props} />;
}
