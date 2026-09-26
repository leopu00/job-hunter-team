/**
 * The main window's pages. The dashboard wears the web's stylesheet and the
 * rest wears the desktop's, and the two cannot share a page: so the Google
 * sign-in (desktop style) lives on index.html beside the local team setup,
 * and the two pages send each other there.
 */
export const DASHBOARD_PAGE = "dashboard.html";
export const SETUP_PAGE = "index.html";
export const LOGIN_PAGE = "index.html?login";

/** Whether index.html was opened to sign in rather than for the setup. */
export function isLoginRequest(search: string = window.location.search): boolean {
  return new URLSearchParams(search).has("login");
}

/** Replaces the current page: Back does not return to a page that just sent you away. */
export function goTo(page: string): void {
  window.location.replace(page);
}
