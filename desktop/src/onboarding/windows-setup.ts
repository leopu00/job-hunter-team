import type { WindowsSetup } from "./onboarding.i18n";

/**
 * What the Windows setup puts on this computer, as
 * scripts/enable-podman-windows-runtime.ps1 does it: the review step lists it
 * before the person starts the setup, which is their consent. A test reads
 * the script and fails when these values and the script's differ.
 */
export const WINDOWS_SETUP: WindowsSetup = {
  podmanVersion: "6.0.2",
  composeVersion: "5.1.2",
  cpus: 2,
  memoryGb: 3,
  diskGb: 30,
};
