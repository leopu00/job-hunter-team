const COOKIE_NAME = 'jht_workspace'
const LS_KEY = 'jht_workspace'

export function getWorkspace(): string | null {
  // Try cookie first
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`))
  if (match?.[1]) return decodeURIComponent(match[1])
  // Fallback to localStorage
  try {
    return localStorage.getItem(LS_KEY)
  } catch {
    return null
  }
}

export function setWorkspace(path: string): void {
  const encoded = encodeURIComponent(path)
  document.cookie = `${COOKIE_NAME}=${encoded}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
  try {
    localStorage.setItem(LS_KEY, path)
  } catch { /* ignore */ }
}

export function clearWorkspace(): void {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`
  try {
    localStorage.removeItem(LS_KEY)
  } catch { /* ignore */ }
}
