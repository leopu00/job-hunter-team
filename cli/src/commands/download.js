import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';


const RELEASE_BASE_URL = 'https://github.com/leopu00/job-hunter-team/releases/download';

const ASSETS = Object.freeze({
  windows: 'job-hunter-team-windows-x64-setup.exe',
  macos: 'job-hunter-team.zip',
  linux: 'job-hunter-team-linux-x64.tar.gz',
});

const WINDOWS_PORTABLE_ASSET = 'job-hunter-team-windows-x64-portable.exe';


function normalizePlatform(value) {
  const aliases = {
    win: 'windows', win32: 'windows', windows: 'windows',
    darwin: 'macos', mac: 'macos', macos: 'macos', osx: 'macos',
    linux: 'linux',
  };
  const platform = aliases[String(value ?? '').trim().toLowerCase()];
  if (!platform) {
    throw new Error(
      `Unsupported operating system: ${value}. Use windows, macos, or linux.`,
    );
  }
  return platform;
}


function normalizeVersion(value) {
  const version = String(value ?? '').trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version: ${value}. Example: 0.3.5.`);
  }
  return version;
}


function userDownloadsDir() {
  const userDir = process.env.JHT_USER_DIR
    || join(homedir(), 'Documents', 'Job Hunter Team');
  return join(userDir, 'downloads');
}


function releaseBaseUrl() {
  return (process.env.JHT_RELEASE_BASE_URL || RELEASE_BASE_URL).replace(/\/+$/, '');
}


async function fetchReleaseFile(url) {
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'job-hunter-team-cli' },
    });
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} for ${basename(url)}.`);
  }
  return response;
}


function checksumFor(checksums, asset) {
  for (const rawLine of checksums.split(/\r?\n/)) {
    const match = rawLine.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && match[2] === asset) return match[1].toLowerCase();
  }
  throw new Error(`Declared SHA-256 not found for ${asset}.`);
}


async function fileSha256(path) {
  const { createReadStream } = await import('node:fs');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}


function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}


function progressTransform(total, digest) {
  let downloaded = 0;
  let lastPercent = -1;
  return new Transform({
    transform(chunk, _encoding, callback) {
      downloaded += chunk.length;
      digest.update(chunk);
      if (process.stderr.isTTY && total > 0) {
        const percent = Math.min(100, Math.floor((downloaded / total) * 100));
        if (percent !== lastPercent) {
          process.stderr.write(`\r  Progress: ${String(percent).padStart(3)}% (${formatBytes(downloaded)})`);
          lastPercent = percent;
        }
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (process.stderr.isTTY && total > 0) process.stderr.write('\n');
      callback();
    },
  });
}


async function destinationExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}


export async function downloadRelease({ platform: requestedPlatform, version: requestedVersion, output, portable }) {
  const platform = normalizePlatform(requestedPlatform);
  const version = normalizeVersion(requestedVersion);
  if (portable && platform !== 'windows') {
    throw new Error('The --portable option is available only for Windows.');
  }

  const asset = portable ? WINDOWS_PORTABLE_ASSET : ASSETS[platform];
  const tag = `v${version}`;
  const base = `${releaseBaseUrl()}/${tag}`;
  const checksumResponse = await fetchReleaseFile(`${base}/SHA256SUMS`);
  const expectedSha256 = checksumFor(await checksumResponse.text(), asset);
  const destination = resolve(output || join(userDownloadsDir(), asset));

  await mkdir(dirname(destination), { recursive: true });
  if (await destinationExists(destination)) {
    const existingSha256 = await fileSha256(destination);
    if (existingSha256 === expectedSha256) {
      console.log(`\n  File already present and verified: ${destination}`);
      console.log(`  SHA-256 verified: ${expectedSha256}\n`);
      return destination;
    }
    throw new Error(`The file ${destination} already exists but its SHA-256 does not match; it was not overwritten.`);
  }

  const response = await fetchReleaseFile(`${base}/${encodeURIComponent(asset)}`);
  if (!response.body) throw new Error(`Download failed: empty response for ${asset}.`);

  const total = Number(response.headers.get('content-length')) || 0;
  const temporary = `${destination}.part-${process.pid}-${Date.now()}`;
  const digest = createHash('sha256');
  console.log(`\n  Downloading ${asset} (${formatBytes(total)})...`);

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      progressTransform(total, digest),
      createWriteStream(temporary, { flags: 'wx' }),
    );
    if (!process.stderr.isTTY) console.error(`  Progress: 100% (${formatBytes(total)})`);

    const actualSha256 = digest.digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `Invalid SHA-256 for ${asset}: expected ${expectedSha256}, got ${actualSha256}.`,
      );
    }
    await rename(temporary, destination);
    console.log(`  SHA-256 verified: ${actualSha256}`);
    console.log(`  Saved to: ${destination}\n`);
    return destination;
  } catch (error) {
    await unlink(temporary).catch((unlinkError) => {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    });
    throw error;
  }
}


async function downloadAction(options) {
  try {
    await downloadRelease({
      platform: options.os,
      version: options.version,
      output: options.output,
      portable: options.portable,
    });
  } catch (error) {
    console.error(`\n  Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}


export function registerDownloadCommand(program) {
  program
    .command('download')
    .description('Download and verify a desktop client from GitHub Releases')
    .requiredOption('--os <platform>', 'operating system: windows, macos, or linux')
    .requiredOption('--version <release>', 'release version (for example, 0.3.5)')
    .option('-o, --output <file>', 'destination file (default: Documents/Job Hunter Team/downloads)')
    .option('--portable', 'download the portable app instead of the Windows installer')
    .action(downloadAction);
}
