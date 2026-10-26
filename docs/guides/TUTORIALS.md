# Tutorials

These are the complete text-first tutorials for the public `/tutorials` page.
Read the path that matches the interface you use; the video after each path is
an optional alternative, not a requirement.

## Desktop app

This tutorial follows the desktop app: it sets up the team, shows how work
moves through it, and how to inspect a result before you decide what to do.

### Plan the setup

This path starts at the website download and ends when the team is ready and
the app opens the chat with the Assistant. It does not assume that the desktop
app or a container engine is already installed. During the first setup the app
installs what the team needs on the environment you choose and downloads the
team's image: how long that takes depends on your connection and your computer.
Keep the app open while it works.

### Set up the team

1. **Download the native desktop app.** Go to
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download). **Desktop**
   is already selected: click macOS or Linux once (Windows is shown as “Not in this version”) to start the
   current release download for that platform.
2. **Open the download for your system.** Windows is not part of 0.4.0: there is no Windows installer in this release.
   On macOS, open `job-hunter-team-macos-universal.dmg` and drag the app into
   Applications; it is signed with an Apple Developer ID and notarized by
   Apple. Only Macs with Apple silicon (M1 and later). Intel Macs are not supported in 0.4.
   The file name says “universal”, but in 0.4 it holds only the Apple silicon build. On Linux, allow `job-hunter-team-linux-x64.AppImage` to run as a
   program and open it, or install `job-hunter-team-linux-x64.deb` on
   Debian-based systems. Linux is experimental in 0.4 and was not tested by hand; it can display a platform warning:
   continue only when the download came from the official site or its linked
   release.
3. **Choose how to start.** The app uses your system's language, or English
   when it does not have that language. Select **Continue with Google**, or
   select **Use locally**, enter a display name, which stays on this device,
   and select **Continue locally**. Setting up a new team on a VPS needs the
   Google sign-in.
4. **Choose the environment.** Select **Start the setup**, then **This
   computer** or **VPS server**. On Windows 0.4 the team runs on this computer
   in Podman inside WSL, installed by the app: WSL must already be enabled, and
   Docker Desktop is not needed. On macOS the app installs Podman with
   Homebrew, which must already be installed; without it, the app says so
   before installing anything. On Linux the app uses Docker: install Docker
   Engine and its Compose plugin before you start, because installing them
   needs administrator rights. The Linux release is built, but this setup has
   not been tested yet. For a VPS, enter its address, the SSH user, the port
   and the private key file, which stays on this computer.
5. **Choose the provider.** Select Codex, then
   **Review the setup**. You sign in with your subscription later in the setup:
   no API key is needed.
6. **Confirm and prepare the team.** The last screen sums up the environment
   and the provider. When the team runs on this computer on Windows, it also
   lists what the app installs and how to remove it later. Select **Prepare the
   team** and keep the app open while it prepares the runtime, the container
   and the provider's tool. For a VPS, the app first shows the server's SSH
   fingerprint: confirm it only if it matches the one your VPS provider shows.
7. **Sign in to the provider.** When the screen says it is your turn, follow
   the request it shows: the provider's sign-in link, a code to enter on the
   provider's page, or a field for the answer the provider gives you.
8. **Meet the Assistant.** When provider, container and agents are verified,
   the app says the team is ready and opens the chat with the Assistant, which
   learns your goals and preferences by talking with you. If a step fails, the
   screen gives its cause with **Retry the preparation** and **Show the log
   file**; if the app closes halfway, the next launch offers **Resume the
   setup** or **Start over**.

### Explore a running team

### 1. Meet the office

Open the native office and select any colleague. Their card shows a name,
current status, and responsibility. You have completed this step when you can
open a card and return to the office without losing your place.

### 2. Know who does what

The office and conversations use these plural department names:
**coordinators** keep priorities moving; **support advisers** help with the
product and your profile; **career advisers** help with direction;
**researchers** find opportunities; **analysts** verify them; **match
assessors** explain fit; **application writers** prepare requested documents;
and **reviewers** check that work before it reaches you. These names are the
stable map from a visible department to its responsibility.

You are ready to continue when you can read the pipeline as one sequence,
rather than as unrelated conversations.

### 3. Ask the researchers

Open the chat with the researchers and ask what the current search is looking
for.
Send one clear question. Your message stays in that conversation and the reply
returns there, so another thread cannot be mistaken for it. The step worked
when the thread shows both your question and its reply.

### 4. Follow verification

Open a conversation with the analysts or inspect activity for a position that
has moved on from discovery. Analysts check the role, organisation, and details
before a position advances. The step worked when you can distinguish a found
lead from a verified opportunity.

### 5. Read the fit

Open a conversation with the match assessors or a scored position. Match
assessors compare the opportunity with your profile and explain the score. A
score is a compatibility estimate, not a decision made for you. The step
worked when you can identify the score and its explanation, then decide whether
the opportunity deserves attention.

### 6. See the whole pipeline

Open **Positions**, select any result, and read its status. **`new`** means the
researchers found it and the analysts verify it next; **`checked`** means the
analysts finished and the match assessors score it next; **`scored`** means the
match assessors finished, so you can decide or request documents. After your
request, **`writing`** means the application writers are preparing them,
**`review`** means the reviewers are checking them, and **`ready`** means the
documents are ready for you. **`applied`** and **`response`** record your action
and its outcome. The step worked when you can name the responsible department
and the next event for the status you see.

### 7. Inspect positions

Open **Positions** and select a strong match. Its card and detail show the
role, organisation, location, working model, score, and status. Where
available, they also show prepared application documents. The step worked when
you can open a result, understand why it is there, and return to the list.

### 8. Decide what happens next

Return to the office. Coordinators keep priorities moving, support advisers
help you use the workspace and complete your profile, and career advisers help
with goals and strategy. Explore, ask, then decide: you remain responsible for
the final choice and for any application.

### Prefer to watch instead?

When the video is available, you can watch it as an alternative.

## Web

The web tutorial helps you follow the work from any signed-in browser, inspect
a position, give feedback, and keep conversations separate.

### Before you begin

Set up sync before signing in: in the native desktop app, open **Settings**,
then **Account**, select **Sign in with Google**, then in the terminal that
opens, open the link, enter the code and approve this device. Next select
**Sync now**. The **Cloud account** row must say **connected** and the
**Device** row must say **paired**. If the sign-in
control is unavailable, start the team first; if the account still says
**local / guest mode** after approval, repeat **Sign in with Google**. Then
sign in to the web app with the same account. To practise every step, wait
until at least one position has a score. An empty dashboard simply means the
team has not yet produced a scored result.

### 1. Start from the dashboard

Open **Dashboard**. It begins with the latest scored positions, so new results
do not hide in an activity feed. On a small screen, use the navigation menu to
reach the same pages. The step worked when you can see a scored result in the
dashboard list and open it.

### 2. Read one position

Open a position from the dashboard or **Positions**. Its detail gives you the
role, location, working model, score breakdown, and review or application
status. Read the score with its explanation: it is a compatibility estimate,
not an instruction to apply. The step worked when you can say what the
position is, how it fits, and which stage it has reached.

### 3. Give useful feedback in Swipe

Open **Swipe** to review one position at a time. Use the decision buttons to
record how interesting it is; dragging left or right only moves between cards.
Choosing **Not interested** excludes that position from further work, and you
can revise an earlier judgement. The step worked when the next card appears
and the reviewed card retains your decision.

### 4. Check team activity

Open **Team**. Its activity view shows what is happening next and attributes
the work to the relevant part of the team. Researchers find opportunities,
analysts verify them, match assessors rank fit, application writers prepare
requested documents, and reviewers check them. The step worked when you can
connect an activity or status to its place in the pipeline.

### 5. Keep conversations separate

Open **Messages** and select a conversation. Support advisers answer questions
about the product and your profile; career advisers focus on goals and career
strategy; coordinators keep priorities moving. Each has its own thread. The
step worked when changing conversation changes the thread rather than mixing
replies together.

### 6. Send one message and follow delivery

Choose the support advisers, write a short question, and send it. The message
appears in that thread immediately and keeps a visible delivery state; the
reply returns to the same conversation. The step worked when you can see your
message, its delivery progress, and the reply without leaving the thread.

### 7. Finish with an informed decision

Return to the position that matters most. Use its role, fit explanation,
status, your Swipe feedback, and team context to decide what you want to do
next. The web app helps you inspect and communicate; the final decision remains
yours.

### Prefer to watch instead?

When the video is available, you can watch it as an alternative.
