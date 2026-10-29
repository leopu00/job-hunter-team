import { ProfileProgressCard } from "../../profile-progress/ProfileProgressCard";
import { useProfileProgress } from "../../profile-progress/useProfileProgress";
import type { ProfileProgressRead } from "../../profile-progress/read";

/**
 * The Profile page of someone with no cloud session (a local profile): the profile is the team's own file on this
 * computer, so the page reads that, the fields and the bar of what the team still needs, and never asks to sign in
 * to a cloud that holds none of it. It follows the file while the page is open (the Assistant writes it as the person
 * talks). The top space clears the button the Team page floats on the right. `read` is for the tests.
 */
export default function LocalProfile({ read }: { read?: () => Promise<ProfileProgressRead> }) {
  const progress = useProfileProgress(read);
  return (
    <section className="max-w-xl mx-auto px-5 pt-16" data-testid="local-profile">
      <ProfileProgressCard progress={progress} />
    </section>
  );
}
