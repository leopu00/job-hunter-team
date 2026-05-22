"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

// Wrapper Client che fa il dynamic import di JobsGlobe (maplibre-gl
// ~1 MB parsed). ssr:false perche' il canvas WebGL non ha senso lato
// server. loading:null per non occupare lo slot visivo prima del mount.
// Vedi docs/internal/2026-05-22-vercel-quota-exhaustion.md insight #10
// e la nota in app/(protected)/dashboard/page.tsx riga 18.
const JobsGlobe = dynamic(() => import("@/app/components/JobsGlobe"), {
  ssr: false,
  loading: () => null,
});

type JobsGlobeProps = ComponentProps<typeof JobsGlobe>;

export default function JobsGlobeLazy(props: JobsGlobeProps) {
  return <JobsGlobe {...props} />;
}
