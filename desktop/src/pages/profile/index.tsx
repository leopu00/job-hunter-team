import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import ProfileLoading from "@/app/(protected)/profile/loading";
import ProfileView, { type ProfileExportLink } from "@/app/(protected)/profile/ProfileView";
import type { Locale } from "@/i18n/config";
import { getProfileT } from "@/lib/profile-i18n";
import { readLocaleCookie } from "@/lib/use-locale";
import { appLocale } from "../../lib/app-locale";
import { pluralText } from "../../lib/plural";
import { cloudSessionReadable } from "../../lib/auth-storage-lock";
import { cloudClient } from "../../lib/cloud-client";
import { readOnce, withReadDeadline } from "../../lib/read-deadline";
import { useCloudDataBlocked } from "../../shell/CloudDataNotice";
import { useRefresh } from "../../shell/router";
import { SHELL_TEXT } from "../../shell/shell.i18n";
import type { PageProps } from "../types";
import { LinkedinLoginCard } from "./LinkedinLoginCard";
import LocalProfile from "./LocalProfile";
import { PROFILE_PAGE_TEXT } from "./profile-page.i18n";
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
export function ProfilePage({ client = cloudClient() }: { client?: SupabaseClient }) {
  const [locale] = useState<Locale>(readLocaleCookie);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const blocked = useCloudDataBlocked();

  const read = useCallback(() => {
    withReadDeadline(readOnce("profile", () => loadProfile(client)))
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
  // No cloud session (a local profile): the page is the team's own profile on this computer, not a sign-in notice.
  if (blocked) return <LocalProfile />;
  if (load.state === "loading") return <ProfileLoading />;
  if (load.state === "signed-out")
    // A readable session that no longer answers as signed in is an expired one; with no cloud session at
    // all (a local profile, above) there never was one.
    return cloudSessionReadable()
      ? <div className="p-12 text-center text-[var(--color-muted)]">{t("session_expired")}</div>
      : null;
  if (load.state === "failed")
    return (
      <div className="max-w-6xl mx-auto px-5 pt-8">
        <p role="alert" className="text-[12px]" style={{ color: "var(--color-red)" }}>
          {PROFILE_PAGE_TEXT[appLocale()].readFailed(SHELL_TEXT[appLocale()].refresh)}
        </p>
        <button
          type="button"
          className="mt-3 border border-[var(--color-border)] rounded px-3 py-1.5 text-[12px]"
          onClick={() => { setLoad({ state: "loading" }); read(); }}
        >
          {SHELL_TEXT[appLocale()].retry}
        </button>
      </div>
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
          {pluralText(appLocale(), data.sealedContacts.length, PROFILE_PAGE_TEXT[appLocale()].sealedContacts, { list: data.sealedContacts.join(", ") })}
        </p>
      )}
      <LinkedinLoginCard />
    </>
  );
}

export default function ProfileRoute(_props: PageProps) {
  return <ProfilePage />;
}
