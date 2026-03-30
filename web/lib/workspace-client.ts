const LS_KEY = 'jht_workspace'

export function getWorkspace(): string | null {
  try {
    return localStorage.getItem(LS_KEY)
  } catch {
    return null
  }
}

export function setWorkspace(path: string): void {
  try {
    localStorage.setItem(LS_KEY, path)
  } catch { /* ignore */ }
}

export function clearWorkspace(): void {
  try {
    localStorage.removeItem(LS_KEY)
  } catch { /* ignore */ }
}
