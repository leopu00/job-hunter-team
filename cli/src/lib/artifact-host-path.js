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

/** The host context names the mount's source, never the skill's read root. */
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
  const root = context.userDir || (absoluteWindowsPath(context.profile)
    ? win32.join(context.profile, 'Documents', 'Job Hunter Team') : null);
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
