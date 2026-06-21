"use client";

import Link from "next/link";
import {
  DocHeader,
  Callout,
  H2,
  H3,
  P,
  UL,
  LI,
  Code,
  Pre,
  GitHubMore,
  repoFile,
} from "../../DocKit";

export default function RunOnAVpsPage() {
  return (
    <div>
      <DocHeader
        emoji="☁️"
        title="Run 24/7 on a VPS"
        tagline="A small cloud server so the team works while you sleep"
      >
        A VPS is the cheapest way to keep the team hunting around the clock — no
        computer left on, no fans, no interruptions. About €6–10/mo on top of
        your provider. This is the recommended setup for a real job search.
      </DocHeader>

      <Callout>
        ✅ <strong>Validated end-to-end</strong> on a Hetzner{" "}
        <strong>CPX22</strong> (4 GB RAM / 2 vCPU / 80 GB SSD, ~€9.75/mo). Any
        provider with a 4 GB-RAM Ubuntu 24.04 box works the same way.
      </Callout>

      <H2>⚡ The whole thing, in short</H2>
      <P>
        From provisioning to the first scored jobs is about 15–30 minutes,
        mostly SSH-key setup. The full sequence on the server:
      </P>
      <Pre>
        {`# After you SSH into the VPS as root:
curl -fsSL https://jobhunterteam.ai/install.sh | bash   # ~1 min
exec bash -l                                            # pick up the jht PATH
jht up                                                  # pull image + start
jht setup                                               # wizard: provider + login
jht providers update                                    # install the provider CLI
jht oauth-login                                         # provider OAuth device flow
jht cloud login                                         # link the VPS to your web account
jht team start                                          # start the agents
jht team status                                         # verify`}
      </Pre>

      <H2>🪜 Step by step</H2>

      <H3>1. Provision the server</H3>
      <P>
        On your cloud console (e.g. Hetzner), create an{" "}
        <strong>Ubuntu 24.04</strong> box, ~4 GB RAM, in an EU region for GDPR.
        Upload a <strong>dedicated</strong> SSH key — don&apos;t reuse your
        personal one:
      </P>
      <Pre>
        {`ssh-keygen -t ed25519 -f ~/.ssh/jht_hetzner -C "jht-vps"
cat ~/.ssh/jht_hetzner.pub   # paste this into the cloud console`}
      </Pre>
      <P>Note the server&apos;s IPv4 address when it&apos;s ready.</P>

      <H3>2. SSH in</H3>
      <Pre>{`ssh -i ~/.ssh/jht_hetzner root@<VPS_IP>`}</Pre>
      <P>
        Tip: before the first connection, compare the host fingerprint shown in
        your console against <Code>ssh-keyscan</Code> to rule out a
        man-in-the-middle.
      </P>

      <H3>3. Add a little swap (recommended)</H3>
      <P>
        Eight agents can spike RAM. 2 GB of preventive swap avoids an OOM kill:
      </P>
      <Pre>
        {`fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab`}
      </Pre>

      <H3>4. Install, configure, start</H3>
      <P>
        Run the one-liner and the commands from the short version above. Two
        things matter on a VPS specifically:
      </P>
      <UL>
        <LI>
          <Code>jht cloud login</Code> — pairs the server to your web account so
          you can see results from any browser. On a VPS this is essential: you
          won&apos;t be at the terminal all day, the{" "}
          <Link
            href="/docs/guides/dashboard-and-results"
            className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
          >
            web dashboard
          </Link>{" "}
          is your main window into the team.
        </LI>
        <LI>
          The container runs <Code>restart: unless-stopped</Code>, so the team
          survives reboots automatically.
        </LI>
      </UL>

      <Callout>
        🖥️ <strong>Prefer no terminal?</strong> The desktop app can connect to
        and control a team running on a VPS — start, stop and monitor it as if
        it were local. See{" "}
        <Link
          href="/run"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          how to run it
        </Link>
        .
      </Callout>

      <Callout>
        🔒 <strong>One team per user.</strong> Don&apos;t run a local team and a
        VPS team at the same time — it splits the source of truth and breaks
        sync. Pick one location per session.
      </Callout>

      <GitHubMore href={repoFile("docs/guides/VPS-SETUP.md")}>
        VPS-SETUP.md
      </GitHubMore>
    </div>
  );
}
