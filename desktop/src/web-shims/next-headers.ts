/**
 * Stand-in for `next/headers` in the desktop. The web's server pages
 * (positions, position) run here as they are, and read two cookies: the
 * visible columns and the salary currency, both written by client components
 * with document.cookie. So cookies() reads document.cookie; there is no
 * request, so headers() is empty.
 */
type Cookie = { name: string; value: string };

function readCookies(): Cookie[] {
  if (typeof document === "undefined" || !document.cookie) return [];
  return document.cookie.split(";").flatMap((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return [];
    const name = part.slice(0, eq).trim();
    if (!name) return [];
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // Left as written: Next hands a malformed value back as it is too.
    }
    return [{ name, value }];
  });
}

export async function cookies() {
  const all = readCookies();
  return {
    get: (name: string): Cookie | undefined => all.find((c) => c.name === name),
    getAll: (): Cookie[] => all,
    has: (name: string): boolean => all.some((c) => c.name === name),
  };
}

export async function headers(): Promise<Headers> {
  return new Headers();
}
