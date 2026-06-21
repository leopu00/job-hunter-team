"use client";

import {
  DocHeader,
  Callout,
  H2,
  P,
  Code,
  Pre,
  GitHubMore,
  repoFile,
} from "../../DocKit";

export default function CliPage() {
  return (
    <div>
      <DocHeader
        emoji="⌨️"
        title="CLI — the jht command"
        tagline="The essential commands to drive the team from a terminal"
      >
        Everything the desktop app and the web do, you can do with{" "}
        <Code>jht</Code>. It&apos;s the single surface humans, power users and
        AI assistants share — self-sufficient for day-to-day operation. Here are
        the commands you&apos;ll actually use.
      </DocHeader>

      <Callout>
        💡 Every command supports <Code>--help</Code>. The full reference —
        every subcommand, flag, and the host-wrapper vs container split — is
        linked at the bottom.
      </Callout>

      <H2>📦 Container lifecycle</H2>
      <Pre>
        {`jht up         # start the container (pulls the image first run)
jht down       # stop it (keeps your data)
jht restart    # same image, fresh process
jht upgrade    # pull a newer image and restart
jht shell      # drop into the container for debugging
jht logs -f    # follow the container logs`}
      </Pre>

      <H2>🧩 Setup & health</H2>
      <Pre>
        {`jht setup      # interactive wizard: provider, OAuth, team start
jht doctor     # check Docker / Node / auth / DB — must exit 0
jht health     # granular service health
jht status     # container + agent process summary`}
      </Pre>

      <H2>🧠 Providers</H2>
      <Pre>
        {`jht providers list       # claude | codex | kimi
jht providers current    # active provider + model
jht providers use kimi   # switch the active provider
jht providers update     # (re)install the provider CLI`}
      </Pre>

      <H2>🤖 The team</H2>
      <Pre>
        {`jht team status              # running / stopped summary
jht team start [agent]       # start one agent, or the whole team
jht team stop  [agent]       # stop one, or --all
jht team chat  <agent>       # interactive chat with an agent
jht team send  <agent> "…"   # one-shot message to an agent`}
      </Pre>
      <P>
        To reload the team after editing config:{" "}
        <Code>jht team stop --all &amp;&amp; jht team start</Code>.
      </P>

      <H2>📊 Positions & monitoring</H2>
      <Pre>
        {`jht positions list           # jobs in the local DB
jht positions show <id>      # detail of one position
jht stats                    # found / scored / applied counts
jht sentinella status        # usage projection (rate-limit watch)
jht sentinella graph         # ASCII usage over time`}
      </Pre>

      <H2>☁️ Cloud sync</H2>
      <Pre>
        {`jht cloud login    # browser device-flow pairing with your web account
jht cloud status   # sync state + last push time
jht cloud push     # push local data to the cloud now
jht cloud disable  # unlink this machine (revoke separately on the web)`}
      </Pre>

      <H2>🔁 Common one-liners</H2>
      <Pre>
        {`# Fresh setup (Local or VPS — same command)
jht up && jht setup

# Switch provider and reload
jht providers use codex && jht providers update codex
jht team stop --all && jht team start

# Daily check
jht status && jht doctor

# Full reset (asks for confirmation)
jht reset full`}
      </Pre>

      <GitHubMore href={repoFile("docs/guides/CLI-REFERENCE.md")}>
        the full CLI reference
      </GitHubMore>
    </div>
  );
}
