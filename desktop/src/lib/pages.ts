/**
 * The main window's pages. The dashboard wears the web's stylesheet and the
 * rest wears the desktop's, and the two cannot share a page: the Google
 * sign-in (desktop style) lives on index.html and sends the authenticated
 * session to the dashboard entrypoint.
 */
export const DASHBOARD_PAGE = "dashboard.html";
export const LOGIN_PAGE = "index.html?login";

/** Replaces the current page: Back does not return to a page that just sent you away. */
export function goTo(page: string): void {
  window.location.replace(page);
}
