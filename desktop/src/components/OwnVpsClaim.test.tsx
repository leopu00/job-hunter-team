import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWN_VPS_CLAIM_TEXT } from "./OwnVpsClaim.i18n";
import OwnVpsClaim from "./OwnVpsClaim";
import { ERROR_CATALOG, describeError } from "../lib/error-catalog";
import { ERROR_CATALOG_LOCALES } from "../lib/error-catalog.locales";
import { isOwnVpsClaimCode, pickOwnVpsState } from "../lib/own-vps-claim";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.invoke.mockReset();
  native.invoke.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("OwnVpsClaim", () => {
  it("claims only after the dialog, with the account's id and the confirmation, and nothing else", async () => {
    const onClaimed = vi.fn();
    render(<OwnVpsClaim reason="own_vps_claim_required" onClaimed={onClaimed} getUserId={async () => ID} />);
    fireEvent.click(screen.getByTestId("own-vps-claim"));
    expect(native.invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId("own-vps-confirm")).toHaveTextContent(OWN_VPS_CLAIM_TEXT.it.confirmBody);
    expect(screen.getByTestId("own-vps-confirm")).not.toHaveTextContent(OWN_VPS_CLAIM_TEXT.it.confirmKeyChanged);
    fireEvent.click(screen.getByTestId("own-vps-confirm-yes"));
    await waitFor(() => expect(onClaimed).toHaveBeenCalledTimes(1));
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("own_vps_claim", { request: { userId: ID, confirmed: true } });
  });

  it("a changed key says so in the invitation and in the dialog", () => {
    render(<OwnVpsClaim reason="own_vps_key_changed" onClaimed={vi.fn()} getUserId={async () => ID} />);
    expect(screen.getByTestId("own-vps-invite")).toHaveTextContent(OWN_VPS_CLAIM_TEXT.it.inviteKeyChanged);
    fireEvent.click(screen.getByTestId("own-vps-claim"));
    expect(screen.getByTestId("own-vps-confirm")).toHaveTextContent(OWN_VPS_CLAIM_TEXT.it.confirmKeyChanged);
  });

  it("without a signed-in account it asks nothing of the native side", async () => {
    const onClaimed = vi.fn();
    render(<OwnVpsClaim reason="own_vps_claim_required" onClaimed={onClaimed} getUserId={async () => null} />);
    fireEvent.click(screen.getByTestId("own-vps-claim"));
    fireEvent.click(screen.getByTestId("own-vps-confirm-yes"));
    expect(await screen.findByTestId("own-vps-failure")).toHaveTextContent(OWN_VPS_CLAIM_TEXT.it.noAccount);
    expect(native.invoke).not.toHaveBeenCalled();
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it("a refusal is told with the catalog's sentence and the person can try again", async () => {
    native.invoke.mockRejectedValue("own_vps_claim_unreachable");
    const onClaimed = vi.fn();
    render(<OwnVpsClaim reason="own_vps_claim_required" onClaimed={onClaimed} getUserId={async () => ID} />);
    fireEvent.click(screen.getByTestId("own-vps-claim"));
    fireEvent.click(screen.getByTestId("own-vps-confirm-yes"));
    expect(await screen.findByTestId("own-vps-failure")).toHaveTextContent(describeError("own_vps_claim_unreachable", { locale: "it" }).text);
    expect(onClaimed).not.toHaveBeenCalled();
    native.invoke.mockResolvedValue(undefined);
    fireEvent.click(screen.getByTestId("own-vps-confirm-yes"));
    await waitFor(() => expect(onClaimed).toHaveBeenCalledTimes(1));
  });
});

describe("the claim's vocabulary", () => {
  it("every code the native side answers is in the catalog, in every language", () => {
    for (const code of ["own_vps_claim_required", "own_vps_key_changed", "own_vps_claim_refused", "own_vps_claim_unreachable", "own_vps_claim_not_confirmed"]) {
      expect(ERROR_CATALOG[code], code).toBeDefined();
      expect(ERROR_CATALOG_LOCALES[code], code).toBeDefined();
      for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"] as const) {
        expect(describeError(code, { locale }).known, `${code} ${locale}`).toBe(true);
      }
    }
  });

  it("recognises the two codes that ask for the claim and the four states the list reports", () => {
    expect(isOwnVpsClaimCode("own_vps_claim_required") && isOwnVpsClaimCode("own_vps_key_changed")).toBe(true);
    expect(isOwnVpsClaimCode("own_vps_claim_refused") || isOwnVpsClaimCode("read_only_link") || isOwnVpsClaimCode(null)).toBe(false);
    expect(["marked", "claimable", "key_changed", "not_own"].map(pickOwnVpsState)).toEqual(["marked", "claimable", "key_changed", "not_own"]);
    expect(pickOwnVpsState("other") ?? pickOwnVpsState(undefined)).toBeNull();
  });

  it("has the same words in every language", () => {
    const keys = Object.keys(OWN_VPS_CLAIM_TEXT.it).sort();
    for (const [locale, text] of Object.entries(OWN_VPS_CLAIM_TEXT)) {
      expect(Object.keys(text).sort(), locale).toEqual(keys);
      for (const value of Object.values(text)) expect(value.trim().length).toBeGreaterThan(3);
    }
  });
});
