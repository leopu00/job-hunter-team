"use client";

import { LandingFooter } from "../components/landing/LandingCTA";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import DeferredVideo from "../components/public-media/DeferredVideo";
import {
  PUBLIC_VIDEOS,
  type PublicVideoKey,
} from "@/lib/public-video-manifest";

type TutorialStep = {
  title: string;
  body: string;
};

type TutorialGuide = {
  intro: string;
  beforeYouBegin: string;
  steps: TutorialStep[];
};

// Testo editoriale canonico consegnato in docs/guides/TUTORIALS.md. La pagina
// lo presenta come guida autosufficiente; il video è deliberatamente dopo i
// passi, ed è soltanto un'alternativa quando sarà pubblicato.
const GUIDES: Record<Extract<PublicVideoKey, "game" | "web">, TutorialGuide> = {
  game: {
    intro:
      "The game tutorial helps you explore the native office, understand how work moves through the team, and inspect a result before you decide what to do.",
    beforeYouBegin:
      "Use the native desktop app. To follow every live step, complete Activate team first: the runtime must be running, a provider authenticated, your profile complete, and working hours set. The office remains explorable before activation, but live replies and positions need the active team.",
    steps: [
      {
        title: "Meet the office",
        body: "Open the native office and select any colleague. Their card shows a name, current status, and responsibility. You have completed this step when you can open a card and return to the office without losing your place.",
      },
      {
        title: "Know who does what",
        body: "The team includes coordinators, support advisers, career advisers, researchers, analysts, match assessors, application writers, and reviewers. Coordinators keep work moving; support advisers help with the product and your profile; career advisers help with direction. Researchers find opportunities, analysts verify them, match assessors explain fit, application writers prepare requested documents, and reviewers check the work before it reaches you. You are ready to continue when you can read the pipeline as one sequence, rather than as unrelated conversations.",
      },
      {
        title: "Ask the researchers",
        body: "Open the chat with the researchers and ask what the current search is looking for. Send one clear question. Your message stays in that conversation and the reply returns there, so another thread cannot be mistaken for it. The step worked when the thread shows both your question and its reply.",
      },
      {
        title: "Follow verification",
        body: "Open a conversation with the analysts or inspect activity for a position that has moved on from discovery. Analysts check the role, organisation, and details before a position advances. The step worked when you can distinguish a found lead from a verified opportunity.",
      },
      {
        title: "Read the fit",
        body: "Open a conversation with the match assessors or a scored position. Match assessors compare the opportunity with your profile and explain the score. A score is a compatibility estimate, not a decision made for you. The step worked when you can identify the score and its explanation, then decide whether the opportunity deserves attention.",
      },
      {
        title: "See the whole pipeline",
        body: "A position moves in order: researchers find it, analysts verify it, match assessors rank it, application writers tailor documents when you request them, and reviewers check those documents. Its status shows where it is in that path. The step worked when a status tells you both what has happened and what may happen next.",
      },
      {
        title: "Inspect positions",
        body: "Open Positions and select a strong match. Its card and detail show the role, organisation, location, working model, score, and status. Where available, they also show prepared application documents. The step worked when you can open a result, understand why it is there, and return to the list.",
      },
      {
        title: "Decide what happens next",
        body: "Return to the office. Coordinators keep priorities moving, support advisers help you use the workspace and complete your profile, and career advisers help with goals and strategy. Explore, ask, then decide: you remain responsible for the final choice and for any application.",
      },
    ],
  },
  web: {
    intro:
      "The web tutorial helps you follow the work from any signed-in browser, inspect a position, give feedback, and keep conversations separate.",
    beforeYouBegin:
      "Sign in to the web app with an account connected to a team that is running in the native app and has account sync configured. To practise every step, wait until at least one position has a score. An empty dashboard simply means the team has not yet produced a scored result.",
    steps: [
      {
        title: "Start from the dashboard",
        body: "Open Dashboard. It begins with the latest scored positions, so new results do not hide in an activity feed. On a small screen, use the navigation menu to reach the same pages. The step worked when you can see a scored result in the dashboard list and open it.",
      },
      {
        title: "Read one position",
        body: "Open a position from the dashboard or Positions. Its detail gives you the role, location, working model, score breakdown, and review or application status. Read the score with its explanation: it is a compatibility estimate, not an instruction to apply. The step worked when you can say what the position is, how it fits, and which stage it has reached.",
      },
      {
        title: "Give useful feedback in Swipe",
        body: "Open Swipe to review one position at a time. Use the decision buttons to record how interesting it is; dragging left or right only moves between cards. Choosing Not interested excludes that position from further work, and you can revise an earlier judgement. The step worked when the next card appears and the reviewed card retains your decision.",
      },
      {
        title: "Check team activity",
        body: "Open Team. Its activity view shows what is happening next and attributes the work to the relevant part of the team. Researchers find opportunities, analysts verify them, match assessors rank fit, application writers prepare requested documents, and reviewers check them. The step worked when you can connect an activity or status to its place in the pipeline.",
      },
      {
        title: "Keep conversations separate",
        body: "Open Messages and select a conversation. Support advisers answer questions about the product and your profile; career advisers focus on goals and career strategy; coordinators keep priorities moving. Each has its own thread. The step worked when changing conversation changes the thread rather than mixing replies together.",
      },
      {
        title: "Send one message and follow delivery",
        body: "Choose the support advisers, write a short question, and send it. The message appears in that thread immediately and keeps a visible delivery state; the reply returns to the same conversation. The step worked when you can see your message, its delivery progress, and the reply without leaving the thread.",
      },
      {
        title: "Finish with an informed decision",
        body: "Return to the position that matters most. Use its role, fit explanation, status, your Swipe feedback, and team context to decide what you want to do next. The web app helps you inspect and communicate; the final decision remains yours.",
      },
    ],
  },
};

function TutorialSlot({ id }: { id: Extract<PublicVideoKey, "game" | "web"> }) {
  const { t } = useLandingI18n();
  const title =
    id === "game" ? t("tutorial_game_title") : t("tutorial_web_title");
  const guide = GUIDES[id];

  return (
    <section
      id={id}
      aria-labelledby={`${id}-tutorial-title`}
      className="scroll-mt-24 border-t border-[var(--color-border)] pt-10 first:border-t-0 first:pt-0"
    >
      <h2
        id={`${id}-tutorial-title`}
        className="mb-3 text-2xl font-bold tracking-tight text-[var(--color-white)] sm:text-3xl"
      >
        {title}
      </h2>
      <p className="max-w-3xl text-[15px] leading-relaxed text-[var(--color-bright)]">
        {guide.intro}
      </p>

      <div className="mt-8 max-w-3xl rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-5 sm:p-6">
        <h3 className="text-lg font-bold tracking-tight text-[var(--color-white)]">
          Before you begin
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-bright)]">
          {guide.beforeYouBegin}
        </p>
      </div>

      <ol className="mt-8 max-w-3xl space-y-7">
        {guide.steps.map((step, index) => (
          <li key={step.title} className="grid grid-cols-[auto_1fr] gap-x-4">
            <span
              aria-hidden
              className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-[var(--color-border)] text-sm font-bold text-[var(--color-green)]"
            >
              {index + 1}
            </span>
            <div>
              <h3 className="text-lg font-bold tracking-tight text-[var(--color-white)]">
                {step.title}
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--color-bright)]">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <aside
        aria-label={`${title} video alternative`}
        className="mt-10 max-w-3xl border-t border-[var(--color-border)] pt-8"
      >
        <h3 className="text-lg font-bold tracking-tight text-[var(--color-white)]">
          Prefer to watch instead?
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-bright)]">
          When the video is available, you can watch it as an alternative.
        </p>
        <div className="mt-4">
          <DeferredVideo video={PUBLIC_VIDEOS[id]} label={title} />
        </div>
      </aside>
    </section>
  );
}

function TutorialsContent() {
  const { t } = useLandingI18n();
  return (
    <>
      <LandingNav />
      <main id="main-content" className="mx-auto max-w-4xl px-6 pt-28 pb-20">
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-white)] sm:text-5xl">
          {t("tutorials_title")}
        </h1>
        <p className="mt-5 max-w-3xl text-[16px] leading-relaxed text-[var(--color-bright)]">
          Choose the path that matches the interface you use. Each guide is
          complete on its own; a video is an optional alternative, not a
          prerequisite.
        </p>
        <nav aria-label="Tutorial paths" className="mt-8 flex flex-wrap gap-3">
          <a
            href="#game"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-white)] transition-colors hover:border-[var(--color-green)] hover:text-[var(--color-green)]"
          >
            {t("tutorial_game_title")}
          </a>
          <a
            href="#web"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-white)] transition-colors hover:border-[var(--color-green)] hover:text-[var(--color-green)]"
          >
            {t("tutorial_web_title")}
          </a>
        </nav>
        <div className="mt-14 space-y-16">
          <TutorialSlot id="game" />
          <TutorialSlot id="web" />
        </div>
      </main>
      <LandingFooter />
    </>
  );
}

export default function TutorialsClient() {
  return (
    <LandingI18nProvider>
      <TutorialsContent />
    </LandingI18nProvider>
  );
}
