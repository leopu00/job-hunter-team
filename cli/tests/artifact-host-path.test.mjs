import assert from 'node:assert/strict';
import { test } from 'node:test';
import { windowsUploadRelativePath } from '../src/lib/artifact-host-path.js';

const root = 'C:\\Users\\Synthetic\\Documents\\Job Hunter Team';
const context = (overrides = {}) => Buffer.from(JSON.stringify({
  profile: 'C:\\Users\\Synthetic', cwd: root, ...overrides,
})).toString('base64');

test('Windows host paths become relatives beneath the mount, including cwd and case-insensitive roots', () => {
  assert.equal(windowsUploadRelativePath(`${root}\\CV synthetic.pdf`, context()), 'CV synthetic.pdf');
  assert.equal(windowsUploadRelativePath('cv.pdf', context()), 'cv.pdf');
  assert.equal(windowsUploadRelativePath('.\\nested\\cv.pdf', context()), 'nested/cv.pdf');
  assert.equal(windowsUploadRelativePath(`${root.toLowerCase()}\\cv.pdf`, context()), 'cv.pdf');
  assert.equal(windowsUploadRelativePath('D:\\Shared documents\\cv.pdf',
    context({ userDir: 'D:\\Shared documents' })), 'cv.pdf');
});

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
