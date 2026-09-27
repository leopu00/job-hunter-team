import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import ProfileLoading from "@/app/(protected)/profile/loading";
import ProfileView, { type ProfileExportLink } from "@/app/(protected)/profile/ProfileView";
import type { Locale } from "@/i18n/config";
import { getProfileT } from "@/lib/profile-i18n";
import { readLocaleCookie } from "@/lib/use-locale";
import { supabase } from "../../lib/supabase";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import { loadProfile, profileExport, type ProfileData } from "./load-profile";

type Load =
  | { state: "loading" }
  | { state: "ready"; data: ProfileData }
  | { state: "signed-out" }
  | { state: "failed" };

/**
 * web/app/(protected)/profile: la stessa resa del web (ProfileView), con i
 * dati letti dalla sessione dell'utente. Come sul web cloud il profilo si
 * guarda e si esporta; la modifica passa dall'assistente, che qui non c'è.
 */
export function ProfilePage({ client = supabase }: { client?: SupabaseClient }) {
  const [locale] = useState<Locale>(readLocaleCookie);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const read = useCallback(() => {
    loadProfile(client)
      .then((data) => setLoad(data ? { state: "ready", data } : { state: "signed-out" }))
      .catch(() => setLoad((prev) => (prev.state === "ready" ? prev : { state: "failed" })));
  }, [client]);

  useEffect(read, [read]);
  useRefresh(read);

  const profile = load.state === "ready" ? load.data.profile : null;
  const exportLink = useMemo<ProfileExportLink | undefined>(() => {
    if (!profile) return undefined;
    const { json, fileName } = profileExport(profile);
    return { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), fileName };
  }, [profile]);
  useEffect(
    () => () => {
      if (exportLink) URL.revokeObjectURL(exportLink.href);
    },
    [exportLink],
  );

  const t = getProfileT(locale);
  if (load.state === "loading") return <ProfileLoading />;
  if (load.state === "signed-out")
    return <div className="p-12 text-center text-[var(--color-muted)]">{t("session_expired")}</div>;
  if (load.state === "failed")
    return (
      <p role="alert" className="max-w-6xl mx-auto px-5 pt-8 text-[12px]" style={{ color: "var(--color-red)" }}>
        Non riesco a leggere il profilo. Controlla la connessione e premi «Aggiorna».
      </p>
    );
  const { data } = load;
  return (
    <>
      <ProfileView
        profile={data.profile}
        blocks={data.blocks}
        cloudContacts={data.contacts}
        locale={locale}
        canEdit={false}
        exportLink={exportLink}
      />
      {data.sealedContacts.length > 0 && (
        <p className="mt-4 text-[11px] text-[var(--color-dim)]">
          Alcuni contatti ({data.sealedContacts.join(", ")}) sono cifrati sul server e nella desktop
          non si aprono ancora.
        </p>
      )}
    </>
  );
}

export default function ProfileRoute(_props: PageProps) {
  return <ProfilePage />;
}
