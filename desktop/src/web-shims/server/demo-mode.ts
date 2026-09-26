import { verdictOf, type Verdict } from "@/lib/position-verdict";

/**
 * Stand-in for web/lib/demo/mode.ts. The demo personas belong to the web's
 * onboarding (a cookie set by the /welcome wizard); the desktop always shows
 * the user's own data, so no persona is ever active.
 */
export type DemoFeedbackEntry = { a: string; s: number | null };
export type DemoFeedbackMap = Record<string, DemoFeedbackEntry>;

export async function activeDemoPersona(): Promise<null> {
  return null;
}

export async function readDemoFeedback(): Promise<DemoFeedbackMap> {
  return {};
}

// Same as the web: the real verdict rule on the compact demo shape.
export function demoVerdictOf(e: DemoFeedbackEntry): Verdict {
  return verdictOf(e.a, e.s);
}
