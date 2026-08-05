# Tutorials

These are the complete text-first tutorials for the public `/tutorials` page.
Read the path that matches the interface you use; the video after each path is
an optional alternative, not a requirement.

## Game

The game tutorial helps you explore the native office, understand how work
moves through the team, and inspect a result before you decide what to do.

### Plan the setup

This path starts at the website download and ends when the team is active; it
does not assume that the desktop app or Docker is already configured. Allow
time before you start. In an observed Linux + Docker end-to-end run, the time
from double-clicking the downloaded app to the first onboarding panel was
**32 minutes 58 seconds**. The full route had already exceeded **54 minutes**
before provider login. Hardware, download speed, and Docker setup change the
result, but this is not a five-minute task.

### Set up the team

1. **Download the native desktop app.** Go to
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download), choose
   **Desktop**, then select macOS, Windows, or Linux. The page always links to
   the current release for that platform.
2. **Open the download for your system.** On Windows, run
   `job-hunter-team.exe`; on macOS, unzip `job-hunter-team.zip` and open the
   app; on Linux, extract `job-hunter-team-linux-x64.tar.gz` and run
   `job-hunter-team.x86_64`. Windows and Linux can display a platform warning:
   continue only when the download came from the official site or its linked
   release.
3. **Enter the office.** Start from the title screen, add your name if you
   want, and enter the office. It is explorable before setup: its preview
   conversations and example positions do not start a live team or use a
   provider.
4. **Open the setup checklist.** Select **Activate team**. Choose a local
   runtime or connect a VPS. A local runtime needs Docker; on Windows, Docker
   Desktop may need its own consent and first-run flow.
5. **Connect a provider.** In the Coordinator setup, select a supported
   subscription provider and plan, then complete its authorization in the
   embedded terminal. An authorization link can open in your browser, while
   codes and choices stay in the office terminal.
6. **Complete the profile.** Fill in the native profile. The ready gate needs
   your name, email, target role, location, experience, seniority, at least
   two skills, and at least one language.
7. **Set working hours.** Choose when the team may work. The checklist stays
   incomplete until the runtime, provider, profile, and working-hours gates
   are all ready.
8. **Activate the team.** Return to **Activate team** and complete the four
   gates. The Coordinator then starts the agents; live replies and positions
   become available in the office.

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
