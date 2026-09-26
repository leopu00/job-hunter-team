import { SETUP_PAGE } from "../../lib/pages";
import ComingSoon from "../coming-soon";
import type { PageProps } from "../types";

/** The web's /team (live agents) is not ported yet; the local team setup is. */
export default function TeamPage(_props: PageProps) {
  return (
    <>
      <ComingSoon title="Team" note="Il monitor del team arriva nella desktop. Il team locale si configura da qui:" />
      <div className="max-w-6xl mx-auto px-5">
        <a href={SETUP_PAGE} className="text-[11px] font-semibold tracking-widest uppercase no-underline" style={{ color: "var(--color-green)" }}>
          Team locale →
        </a>
      </div>
    </>
  );
}
