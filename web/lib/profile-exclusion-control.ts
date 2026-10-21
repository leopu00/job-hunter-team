"use client";

import { createContext, useContext } from "react";

/**
 * Who may change the exclusions of the profile (JHT-T24): the desktop app, not the website.
 * The website shows the proposal and the active exclusions and says where to decide; the desktop
 * provides `canChange: true` outside the read-only view. Nothing provides it by default.
 */
export type ProfileExclusionControl = { canChange: boolean };

const WEB: ProfileExclusionControl = { canChange: false };

const ProfileExclusionControlContext =
  createContext<ProfileExclusionControl>(WEB);

export const ProfileExclusionControlProvider =
  ProfileExclusionControlContext.Provider;

export function useProfileExclusionControl(): ProfileExclusionControl {
  return useContext(ProfileExclusionControlContext);
}
