/**
 * What the close dialog needs to know about a setup under way: the step it is at, and whether it stopped on a failure.
 * The setup page says it while it shows a step before the team's start; then the agents have not started, and the dialog
 * asks about what the setup left on (the machine) instead of how to stop a team.
 */
export interface SetupExit {
  failed: boolean;
  /** 1-based, of `total` */
  step: number;
  total: number;
  /** the step's name, as the page shows it */
  label: string;
}

let current: SetupExit | null = null;

export function setSetupExit(value: SetupExit | null): void {
  current = value;
}

export function setupExit(): SetupExit | null {
  return current;
}
