import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_PROFILES_TEXT } from "../components/local-profiles.i18n";
import { LocalTeamOwnerBanner, readNativeTeamOwnerView, readTeamOwnerView } from "./LocalTeamOwnerBanner";

const V2 = "jht.desktop.local-profiles.v2";

function save(activeId: string | null, ownerStarted: string | null) {
  localStorage.setItem(V2, JSON.stringify({
    version: 2,
    activeId,
    teamOwnerId: null,
    profiles: [
      { profileId: "profile-a", displayName: "Ada", createdAt: 1 },
      { profileId: "profile-b", displayName: "Bea", createdAt: 2 },
    ],
  }));
  if (activeId) localStorage.setItem("jht.desktop.identity.v1", "local");
  if (ownerStarted) localStorage.setItem(`jht.desktop.onboarding.local:${ownerStarted}`, "started-v1");
}

beforeEach(() => {
  localStorage.clear();
  localStorage.removeItem("jht-lang");
});

describe("the band that says whose the team of this computer is", () => {
  it("shows when the profile in use is not the one that has the team, with its name", async () => {
    save("profile-b", "profile-a");
    render(<LocalTeamOwnerBanner locale="it" />);
    expect(await screen.findByTestId("local-team-owner-banner")).toHaveTextContent(
      "Su questo Mac la squadra risulta di Ada: passa a quel profilo per usarla.",
    );
  });

  it("says nothing to the owner, to a Google account, or while nobody is known to have the team", async () => {
    save("profile-a", "profile-a");
    const owner = render(<LocalTeamOwnerBanner locale="it" />);
    await act(async () => undefined);
    expect(owner.container).toBeEmptyDOMElement();
    owner.unmount();

    // the local identity is not the one selected: a Google account is in use
    localStorage.clear();
    save("profile-b", "profile-a");
    localStorage.removeItem("jht.desktop.identity.v1");
    const google = render(<LocalTeamOwnerBanner locale="it" />);
    await act(async () => undefined);
    expect(google.container).toBeEmptyDOMElement();
    google.unmount();

    localStorage.clear();
    save("profile-b", null);
    const nobody = render(<LocalTeamOwnerBanner locale="it" />);
    await act(async () => undefined);
    expect(nobody.container).toBeEmptyDOMElement();
  });

  it("reads the renderer's copy: the profile in use against the first one that started a setup", () => {
    save("profile-b", "profile-a");
    expect(readTeamOwnerView()).toEqual({ owner: "other", name: "Ada" });
    save("profile-a", "profile-a");
    expect(readTeamOwnerView()).toEqual({ owner: "self" });
    save(null, "profile-a");
    expect(readTeamOwnerView()).toEqual({ owner: "none" });
  });

  it("uses the sentence without a name when the owner's name is not known", async () => {
    render(<LocalTeamOwnerBanner locale="it" read={() => ({ owner: "other", name: null })} />);
    expect(await screen.findByTestId("local-team-owner-banner")).toHaveTextContent(
      "Su questo Mac la squadra risulta di un altro profilo: passa a quel profilo per usarla.",
    );
  });

  it.each(Object.keys(LOCAL_PROFILES_TEXT) as (keyof typeof LOCAL_PROFILES_TEXT)[])(
    "%s: names the owner, whatever the name, and keeps the name out of any markup",
    async (locale) => {
      render(<LocalTeamOwnerBanner locale={locale} read={() => ({ owner: "other", name: "<b>$&</b> Ada" })} />);
      const banner = await screen.findByTestId("local-team-owner-banner");
      expect(banner).toHaveTextContent("<b>$&</b> Ada");
      expect(banner.querySelector("b")).toBeNull();
      expect(banner).not.toHaveTextContent("{name}");
    },
  );

  it("leads to the choice of profile through the app's own sign-out, once", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onSwitch = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<LocalTeamOwnerBanner locale="it" read={() => ({ owner: "other", name: "Ada" })} onSwitch={onSwitch} />);

    const button = await screen.findByRole("button", { name: "Cambia profilo" });
    await user.click(button);
    expect(onSwitch).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    await act(async () => finish());
    expect(button).toBeEnabled();
  });

  it("has no button when the app gives no way to leave the profile", async () => {
    render(<LocalTeamOwnerBanner locale="it" read={() => ({ owner: "other", name: "Ada" })} />);
    await screen.findByTestId("local-team-owner-banner");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads again when the window comes back, after the other profile started its setup", async () => {
    save("profile-b", null);
    render(<LocalTeamOwnerBanner locale="it" />);
    await act(async () => undefined);
    expect(screen.queryByTestId("local-team-owner-banner")).toBeNull();
    localStorage.setItem("jht.desktop.onboarding.local:profile-a", "started-v1");
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByTestId("local-team-owner-banner")).toBeInTheDocument();
  });
});

describe("the backend's answer over the renderer's copy", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  function saveReal() {
    localStorage.setItem(V2, JSON.stringify({
      version: 2,
      activeId: B,
      teamOwnerId: null,
      profiles: [
        { profileId: A, displayName: "Ada", createdAt: 1 },
        { profileId: B, displayName: "Bea", createdAt: 2 },
      ],
    }));
    localStorage.setItem("jht.desktop.identity.v1", "local");
  }

  it("names a local owner by the saved profile's name, and does not need the copy to know it", async () => {
    saveReal();
    await expect(readNativeTeamOwnerView(async () => ({ kind: "local", profileId: A }))).resolves.toEqual({ owner: "other", name: "Ada" });
    await expect(readNativeTeamOwnerView(async () => ({ kind: "local", profileId: B }))).resolves.toEqual({ owner: "self" });
    await expect(readNativeTeamOwnerView(async () => null)).resolves.toEqual({ owner: "none" });
  });

  it("is another owner (an account, or a profile this list does not have) without a name", async () => {
    saveReal();
    await expect(readNativeTeamOwnerView(async () => ({ kind: "google" }))).resolves.toEqual({ owner: "other", name: null, account: true });
    await expect(readNativeTeamOwnerView(async () => ({ kind: "local", profileId: "c".repeat(64) }))).resolves.toEqual({ owner: "other", name: null });
  });

  it("is nothing to say when no local profile is in use, and unknown when the backend cannot be asked", async () => {
    saveReal();
    localStorage.removeItem("jht.desktop.identity.v1");
    await expect(readNativeTeamOwnerView(async () => ({ kind: "local", profileId: A }))).resolves.toEqual({ owner: "none" });
    saveReal();
    await expect(readNativeTeamOwnerView(async () => { throw { code: "desktop_only" }; })).resolves.toBeNull();
    await expect(readNativeTeamOwnerView(async () => { throw { code: "local_account_owner_invalid" }; })).resolves.toBeNull();
  });

  it("lets the backend's answer win both ways, without showing the copy first", async () => {
    // the copy says the other profile has the team; the backend says nobody does yet
    save("profile-b", "profile-a");
    const none = render(<LocalTeamOwnerBanner locale="it" readNative={async () => ({ owner: "none" })} />);
    await act(async () => undefined);
    expect(none.container).toBeEmptyDOMElement();
    none.unmount();

    // the copy knows nobody; the backend names the owner
    localStorage.clear();
    save("profile-b", null);
    render(<LocalTeamOwnerBanner locale="it" readNative={async () => ({ owner: "other", name: "Ada" })} />);
    expect(await screen.findByTestId("local-team-owner-banner")).toHaveTextContent("risulta di Ada");
  });

  it("shows nothing while the backend is asked, and the copy only if it does not answer in a moment", async () => {
    vi.useFakeTimers();
    try {
      save("profile-b", "profile-a");
      render(<LocalTeamOwnerBanner locale="it" readNative={() => new Promise<never>(() => undefined)} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
      expect(screen.queryByTestId("local-team-owner-banner")).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(screen.getByTestId("local-team-owner-banner")).toHaveTextContent("risulta di Ada");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says «un account Google» when the owner is an account", async () => {
    saveReal();
    await expect(readNativeTeamOwnerView(async () => ({ kind: "google" }))).resolves.toEqual({ owner: "other", name: null, account: true });
    render(<LocalTeamOwnerBanner locale="it" readNative={async () => ({ owner: "other", name: null, account: true })} />);
    expect(await screen.findByTestId("local-team-owner-banner")).toHaveTextContent(
      "Su questo Mac la squadra risulta di un account Google: passa a quel profilo per usarla.",
    );
  });

  it("keeps the copy when the backend cannot say", async () => {
    save("profile-b", "profile-a");
    render(<LocalTeamOwnerBanner locale="it" readNative={async () => null} />);
    expect(await screen.findByTestId("local-team-owner-banner")).toHaveTextContent("risulta di Ada");
  });

  it("uses the sentence without a name when the backend names an account", async () => {
    save("profile-b", null);
    render(<LocalTeamOwnerBanner locale="it" readNative={async () => ({ owner: "other", name: null })} />);
    expect(await screen.findByTestId("local-team-owner-banner")).toHaveTextContent("risulta di un altro profilo");
  });
});

describe("data that no profile owns", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  function saveReal() {
    localStorage.setItem(V2, JSON.stringify({
      version: 2,
      activeId: B,
      teamOwnerId: null,
      profiles: [{ profileId: B, displayName: "Bea", createdAt: 1 }],
    }));
    localStorage.setItem("jht.desktop.identity.v1", "local");
  }

  it("is nobody only when no marker names anyone and the backend says the data belong to no profile", async () => {
    saveReal();
    await expect(readNativeTeamOwnerView(async () => null, async () => "nobody")).resolves.toEqual({ owner: "nobody" });
    // nobody has taken the team yet, or the probe cannot say: nothing to tell
    await expect(readNativeTeamOwnerView(async () => null, async () => "none")).resolves.toEqual({ owner: "none" });
    await expect(readNativeTeamOwnerView(async () => null, async () => "self")).resolves.toEqual({ owner: "none" });
    await expect(readNativeTeamOwnerView(async () => null, async () => { throw { code: "local_team_owner_invalid" }; })).resolves.toEqual({ owner: "none" });
  });

  it("does not ask the second question when a marker names the owner", async () => {
    saveReal();
    const probe = vi.fn(async () => "nobody" as const);
    await expect(readNativeTeamOwnerView(async () => ({ kind: "local", profileId: A }), probe)).resolves.toEqual({ owner: "other", name: null });
    await expect(readNativeTeamOwnerView(async () => ({ kind: "local", profileId: B }), probe)).resolves.toEqual({ owner: "self" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("says its own sentence, not «the team is another profile's», and offers no profile to switch to", async () => {
    saveReal();
    render(<LocalTeamOwnerBanner locale="it" readNative={async () => ({ owner: "nobody" })} onSwitch={vi.fn(async () => undefined)} />);
    const banner = await screen.findByTestId("local-team-owner-banner");
    expect(banner).toHaveTextContent(LOCAL_PROFILES_TEXT.it.ownerBannerNobody);
    expect(banner).not.toHaveTextContent(LOCAL_PROFILES_TEXT.it.ownerBannerUnknown);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(Object.keys(LOCAL_PROFILES_TEXT) as (keyof typeof LOCAL_PROFILES_TEXT)[])("%s: has the sentence, and it is not one of the others", async (locale) => {
    saveReal();
    render(<LocalTeamOwnerBanner locale={locale} readNative={async () => ({ owner: "nobody" })} />);
    const banner = await screen.findByTestId("local-team-owner-banner");
    const t = LOCAL_PROFILES_TEXT[locale];
    expect(banner).toHaveTextContent(t.ownerBannerNobody);
    expect(t.ownerBannerNobody).not.toBe(t.ownerBannerUnknown);
    expect(t.ownerBannerNobody).not.toBe(t.ownerBannerAccount);
  });
});
