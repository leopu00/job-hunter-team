import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRegularFile } from './secure-config-io.js';
import { MAX_PROFILE_BYTES } from './profile-import.js';
import { JHT_PROFILE_DIR } from '../jht-paths.js';
import { t, tf } from '../../wizard/i18n.js';

const READER = fileURLToPath(new URL('../../../shared/skills/profile_show.py', import.meta.url));
const MAX_READER_BYTES = MAX_PROFILE_BYTES * 8;
const STATES = {
  profile_complete: ['complete', 0], profile_absent: ['absent', 1],
  profile_unreadable: ['unreadable', 2], profile_reader_unavailable: ['unreadable', 2],
  profile_incomplete: ['incomplete', 3],
};

function outcome(code, extra = {}) {
  const [state, exitCode] = STATES[code];
  return { exitCode, value: { ok: exitCode === 0, state, code, profile: null, ...extra } };
}

export function readSavedProfile(profileDir = JHT_PROFILE_DIR) {
  let bytes;
  try {
    bytes = readRegularFile(join(profileDir, 'candidate_profile.yml'), { maxBytes: MAX_PROFILE_BYTES });
  } catch (error) {
    return outcome(error?.code === 'ENOENT' ? 'profile_absent' : 'profile_unreadable');
  }
  const reply = spawnSync('python3', ['-B', '-I', READER, String(MAX_PROFILE_BYTES), String(MAX_READER_BYTES)], {
    input: bytes, encoding: 'utf8', timeout: 5000, maxBuffer: MAX_READER_BYTES,
  });
  if (reply.error || reply.status !== 0) {
    if (reply.status === 2) {
      try {
        const code = JSON.parse(reply.stdout).code;
        if (code === 'profile_unreadable') return outcome(code);
      } catch { /* invalid reader output is an explicit unavailable result below */ }
    }
    return outcome('profile_reader_unavailable');
  }
  try {
    const value = JSON.parse(reply.stdout);
    if (!['profile_complete', 'profile_incomplete'].includes(value.code)
        || !value.profile || typeof value.profile !== 'object' || Array.isArray(value.profile)
        || !Array.isArray(value.missing) || value.missing.some((key) => typeof key !== 'string')) {
      return outcome('profile_reader_unavailable');
    }
    return outcome(value.code, { profile: value.profile, missing: value.missing });
  } catch {
    return outcome('profile_reader_unavailable');
  }
}

function printable(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => JSON.stringify(character).slice(1, -1));
}

function label(key) {
  const name = `profile.show.field.${key}`;
  const translated = t(name);
  return printable(translated === name ? key.replaceAll('_', ' ') : translated);
}

function content(value, depth = 0) {
  const indent = '  '.repeat(depth);
  if (value === null || typeof value !== 'object') return [`${indent}${printable(value)}`];
  const lines = [];
  for (const [key, item] of Object.entries(value)) {
    const heading = Array.isArray(value) ? '-' : `${label(key)}:`;
    if (item !== null && typeof item === 'object') {
      lines.push(`${indent}${heading}`, ...content(item, depth + 1));
    } else lines.push(`${indent}${heading} ${printable(item)}`);
  }
  return lines;
}

export function showProfileAction(options) {
  const result = readSavedProfile();
  process.exitCode = result.exitCode;
  if (options.json) {
    console.log(JSON.stringify(result.value));
    return;
  }
  const { code, state, profile, missing } = result.value;
  const message = `[${code}] ${t(`profile.show.${code}`)}`;
  if (profile === null) {
    console.error(message);
    return;
  }
  console.log(`\n${t('profile.show.title')}\n${message}`);
  if (state === 'incomplete') console.log(tf('profile.show.missing', missing.map(label).join(', ')));
  console.log(content(profile).join('\n'));
}
