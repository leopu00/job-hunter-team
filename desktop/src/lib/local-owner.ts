import {
  confirmLocalOwnerChange,
  probeLocalOwner,
  returnToLocalOwner,
  takeOverLocalOwner,
} from "./onboarding-runtime";
import { switchToOwnerLocalProfile } from "./local-profile";

/**
 * The two ways out of «the runtime belongs to another profile» (OnboardingFlowProps.localOwner). Each way asks
 * the native side for its own single-use token at the moment it runs, which is when the person confirmed, and
 * spends it in the one call that follows: nothing is kept between two clicks.
 */
export function localOwnerWays(onProfileChanged: () => void) {
  return {
    probe: probeLocalOwner,
    returnToOwner: async (): Promise<void> => {
      const profileId = await returnToLocalOwner(await confirmLocalOwnerChange("return"));
      switchToOwnerLocalProfile(profileId);
      onProfileChanged();
    },
    takeOver: async (): Promise<void> => takeOverLocalOwner(await confirmLocalOwnerChange("takeover")),
  };
}
