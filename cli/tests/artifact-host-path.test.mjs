import assert from 'node:assert/strict';
import { test } from 'node:test';
import { windowsUploadRelativePath } from '../src/lib/artifact-host-path.js';

const root = 'C:\\Users\\Synthetic\\Documents\\Job Hunter Team';
const mount = (source = root) => ({ Type: 'bind', Source: source, Destination: '/jht_user' });
const context = (overrides = {}) => Buffer.from(JSON.stringify({
  mounts: JSON.stringify([mount()]), cwd: root, ...overrides,
})).toString('base64');

test('Windows host paths become relatives beneath the mount, including cwd and case-insensitive roots', () => {
  assert.equal(windowsUploadRelativePath(`${root}\\CV synthetic.pdf`, context()), 'CV synthetic.pdf');
  assert.equal(windowsUploadRelativePath('cv.pdf', context()), 'cv.pdf');
  assert.equal(windowsUploadRelativePath('.\\nested\\cv.pdf', context()), 'nested/cv.pdf');
  assert.equal(windowsUploadRelativePath(`${root.toLowerCase()}\\cv.pdf`, context()), 'cv.pdf');
  assert.equal(windowsUploadRelativePath('D:\\Shared documents\\cv.pdf',
    context({ mounts: JSON.stringify([mount('D:\\Shared documents')]) })), 'cv.pdf');
});

for (const source of ['/mnt/c/Users/Synthetic/Documents/Job Hunter Team',
  '/mnt/host/c/Users/Synthetic/Documents/Job Hunter Team',
  '/host_mnt/c/Users/Synthetic/Documents/Job Hunter Team',
  '/run/desktop/mnt/host/c/Users/Synthetic/Documents/Job Hunter Team']) {
  test(`the engine's Windows drive representation is resolved: ${source}`, () => {
    assert.equal(windowsUploadRelativePath(`${root}\\cv.pdf`,
      context({ mounts: JSON.stringify([mount(source)]) })), 'cv.pdf');
  });
}

for (const mounts of ['not json', '{}', '[]', JSON.stringify([mount(), mount()]),
  JSON.stringify([{ ...mount(), Type: 'volume' }]), JSON.stringify([mount('/unrecognised/source')])]) {
  test(`missing, ambiguous or non-bind mount metadata is refused: ${mounts}`, () => {
    assert.throws(() => windowsUploadRelativePath(`${root}\\cv.pdf`, context({ mounts })),
      /artifact_host_path_unavailable/);
  });
}

for (const written of ['C:cv.pdf', '\\cv.pdf', '\\\\server\\cv.pdf', '//server/share/cv.pdf',
  'D:\\cv.pdf', `${root}-other\\cv.pdf`, `${root}\\..\\cv.pdf`, `${root}\\cv.pdf:stream`,
  `${root}\\cv?.pdf`, `${root}\\a\u0000.pdf`]) {
  test(`an outside or ambiguous host path is refused: ${JSON.stringify(written)}`, () => {
    assert.throws(() => windowsUploadRelativePath(written, context()), /artifact_host_path_unavailable/);
  });
}

for (const invalid of ['not json', JSON.stringify(null), JSON.stringify([]), JSON.stringify({}),
  JSON.stringify({ userDir: '\\\\server\\share' }), JSON.stringify({ profile: 12 })]) {
  test(`an invalid host context is refused: ${invalid}`, () => {
    const encoded = Buffer.from(invalid).toString('base64');
    assert.throws(() => windowsUploadRelativePath('cv.pdf', encoded), /artifact_host_path_unavailable/);
  });
}

test('existing local and explicit container paths keep their original CLI reader', () => {
  assert.equal(windowsUploadRelativePath('/tmp/cv.pdf', undefined), null);
  assert.equal(windowsUploadRelativePath('/jht_user/cv.pdf', context()), null);
  assert.throws(() => windowsUploadRelativePath('cv.pdf', context({ cwd: '\\ambiguous' })),
    /artifact_host_path_unavailable/);
});
