// Pure repo-link helpers, safe to import from both server and client modules.
// (They used to live in DocKit.tsx, but that file is "use client" — calling
// these from a server component tripped Next's client-function-from-server
// guard. Keeping them in a plain module fixes that for every guide page.)

export const REPO = "https://github.com/leopu00/job-hunter-team";

/** Build a link into a repo file on the master branch. */
export const repoFile = (path: string) => `${REPO}/blob/master/${path}`;

/** Build a link into a repo folder (tree) on the master branch. */
export const repoTree = (path: string) => `${REPO}/tree/master/${path}`;
