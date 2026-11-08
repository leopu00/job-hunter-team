import { win32 } from 'node:path';

const REFUSAL = 'artifact_host_path_unavailable: With the CLI only, copy the document ' +
  'into the shared Job Hunter Team folder and retry with that path. ' +
  'Inside the team, mounted documents are under /jht_user/.';

function refuse() {
  throw new Error(REFUSAL);
}

function absoluteWindowsPath(value) {
  return typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value)
    && !/[\x00-\x1f<>"|?*:]/.test(value.slice(2));
}

function mountedWindowsRoot(raw) {
  let mounts;
  try { mounts = JSON.parse(raw); } catch { refuse(); }
  if (!Array.isArray(mounts)) refuse();
  const matched = mounts.filter((mount) => mount?.Destination === '/jht_user');
  if (matched.length !== 1 || matched[0].Type !== 'bind') refuse();
  const source = matched[0].Source;
  if (absoluteWindowsPath(source)) return source;
  // Docker Desktop and the Podman WSL machine report their Linux drive mount.
  const drive = typeof source === 'string' && source.match(
    /^\/(?:mnt\/|mnt\/host\/|host_mnt\/|run\/desktop\/mnt\/host\/)([a-zA-Z])\/(.*)$/);
  if (!drive) refuse();
  const root = `${drive[1]}:\\${drive[2].replaceAll('/', '\\')}`;
  if (!absoluteWindowsPath(root)) refuse();
  return root;
}

/** Only the inspected bind of the pinned container determines its host root. */
export function windowsUploadRelativePath(file, encodedContext) {
  if (!encodedContext) return null;
  if (typeof file !== 'string' || !file) refuse();
  let context;
  try {
    context = JSON.parse(Buffer.from(encodedContext, 'base64').toString('utf8'));
  } catch {
    refuse();
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) refuse();
  // An explicit container path keeps the existing CLI path; UNC is not one.
  if (file.startsWith('/') && !file.startsWith('//')) return null;
  const root = mountedWindowsRoot(context.mounts);
  if (!absoluteWindowsPath(root)
      || /[\x00-\x1f<>"|?*]/.test(file) || file.split(/[\\/]/).includes('..')) refuse();
  let absolute = file;
  if (!absoluteWindowsPath(file)) {
    if (/[:\\/]/.test(file[0] || '') || file.includes(':')
        || !absoluteWindowsPath(context.cwd)) refuse();
    absolute = win32.resolve(context.cwd, file);
  }
  if (!absoluteWindowsPath(absolute)) refuse();
  const relative = win32.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith('..\\')
      || win32.isAbsolute(relative) || relative.includes(':')) refuse();
  return relative.split('\\').join('/');
}
