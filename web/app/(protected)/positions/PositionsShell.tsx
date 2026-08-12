"use client";

import { useState } from "react";
import PositionsFilterSidebar from "./PositionsFilterSidebar";
import PositionsSearch from "./PositionsSearch";
import SortPicker from "./SortPicker";

/**
 * Layout della pagina /positions: gestisce il collapse della sidebar filtri.
 * - aperta: sidebar a sinistra (300px) + contenuto a destra
 * - chiusa: nessuna sidebar (la tabella prende tutta la larghezza) e un
 *   pulsante "⚙ Filtri" compare nella toolbar, al livello di "Righe per pagina"
 *
 * Lo stato vive qui (client) così sidebar e pulsante Filtri lo condividono
 * senza passare dall'URL (niente refetch delle posizioni al toggle).
 * `rowsControl` e `children` (tabella + paginazione) sono renderizzati lato
 * server da page.tsx e passati attraverso.
 */
export default function PositionsShell({
  availableSources,
  filtersLabel,
  rowsControl,
  children,
}: {
  availableSources: string[];
  filtersLabel: string;
  rowsControl: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-stretch md:items-start">
      {!collapsed && (
        <PositionsFilterSidebar
          availableSources={availableSources}
          onCollapse={() => setCollapsed(true)}
        />
      )}
      <div className="flex-1 min-w-0">
        {/* Toolbar: pulsante Filtri (solo da chiuso) a sinistra, righe per
            pagina a destra. h-8 + mb-4 = stessa altezza/margine della header
            sidebar, così la tabella si allinea con la prima card. */}
        <div className="mb-4 h-8 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            {collapsed ? (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                title={filtersLabel}
                aria-label={filtersLabel}
                className="h-8 px-3 inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] uppercase rounded-lg border cursor-pointer transition-colors"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-base)",
                  background: "var(--color-card)",
                }}
              >
                <span aria-hidden>⚙</span>
                {filtersLabel}
              </button>
            ) : (
              <span />
            )}
            {/* Ordinamento per la vista a card (mobile): niente header di
                colonna lì — stesso sort/dir URL della tabella. */}
            <SortPicker />
          </span>
          {/* O-60 — la ricerca sta al centro della toolbar, sopra la tabella:
              dentro la tabella sarebbe una colonna che scorre via insieme
              alle altre proprio mentre la si cerca. */}
          <PositionsSearch />
          {rowsControl}
        </div>
        {children}
      </div>
    </div>
  );
}
