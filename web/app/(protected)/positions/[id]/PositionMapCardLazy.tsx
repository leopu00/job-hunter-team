"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

// Dynamic import di maplibre-gl (~1 MB parsed) come per JobsGlobeLazy:
// ssr:false (canvas WebGL) e nessun placeholder — la card mostra il testo
// città/paese subito, la mappa monta quando il chunk arriva.
const PositionMapCard = dynamic(() => import("./PositionMapCard"), {
  ssr: false,
  loading: () => null,
});

type Props = ComponentProps<typeof PositionMapCard>;

export default function PositionMapCardLazy(props: Props) {
  return <PositionMapCard {...props} />;
}
