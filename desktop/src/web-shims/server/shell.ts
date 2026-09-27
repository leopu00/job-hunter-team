/**
 * Stand-in for web/lib/shell.ts, which runs commands on the web server's host
 * (child_process): tmux, the agents' send script. The desktop takes the cloud
 * branch of every route that imports it, where the web never runs a command
 * either (requireLocalWrite refuses first, team/status reads Supabase). If one
 * were reached anyway, it must fail, not pretend.
 */
function refuse(): never {
  throw new Error("no shell in the desktop webview");
}

export async function runBash(_cmd: string): Promise<{ stdout: string; stderr: string }> {
  return refuse();
}

export async function runScript(_scriptPath: string, ..._args: string[]): Promise<{ stdout: string; stderr: string }> {
  return refuse();
}

export function toWslPath(_winPath: string): string {
  return refuse();
}
