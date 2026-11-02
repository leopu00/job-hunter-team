// `jht team chat`: a message is never pasted into a turn in progress (A2 of the Linux CLI gate, 02/11: the second
// line, typed while the Assistant was still answering the first, never reached it and the chat said only «no reply yet»).
import assert from 'node:assert/strict';
import test from 'node:test';
import { paneLooksBusy, waitForFreePane } from '../src/commands/team/chat.js';

const WORKING = [
  '• Ran jht profile validate',
  '',
  '◦ Working (16s • esc to interrupt)',
  '',
  '› Run /review on my current changes',
  '  gpt-5.6-terra high · 100% context left',
].join('\n');
const FREE = [
  '• Ran jht-send \'[caldo] Thanks\'',
  '',
  '› Run /review on my current changes',
  '  gpt-5.6-terra high · 100% context left',
].join('\n');

test('a status line with «esc to interrupt» is a turn in progress', () => {
  assert.equal(paneLooksBusy(WORKING), true);
  assert.equal(paneLooksBusy('● Thinking… (esc to interrupt · ctrl+t to show todos)'), true);
  assert.equal(paneLooksBusy(FREE), false);
  assert.equal(paneLooksBusy(''), false);
  assert.equal(paneLooksBusy(null), false);
});

test('the phrase in prose, quoted, or far up the screen is not a status line (in doubt: not busy)', () => {
  assert.equal(paneLooksBusy('● All three workers running (esc to interrupt confirmed on each of them, then done).'), false);
  assert.equal(paneLooksBusy('then confirm "esc to interrupt" before calling it fixed.'), false);
  const old = [WORKING, ...Array.from({ length: 12 }, () => '• done')].join('\n');
  assert.equal(paneLooksBusy(old), false, 'only the last rows count: the transcript scrolls up');
});

test('terminal colour codes do not hide the status line', () => {
  assert.equal(paneLooksBusy('\u001b[2m◦ Working (16s • esc to interrupt)\u001b[0m'), true);
});

test('a free pane is sent to at once, with no waiting and no notice', async () => {
  let waited = 0;
  let told = 0;
  const free = await waitForFreePane({ capture: () => FREE, sleep: async () => { waited += 1; }, onWait: () => { told += 1; } });
  assert.deepEqual([free, waited, told], [true, 0, 0]);
});

test('the second message waits for the first turn to end, says so once, and is sent after', async () => {
  const screens = [WORKING, WORKING, WORKING, FREE];
  let told = 0;
  let sleeps = 0;
  const free = await waitForFreePane({
    capture: () => screens.shift() ?? FREE,
    sleep: async () => { sleeps += 1; },
    onWait: () => { told += 1; },
  });
  assert.equal(free, true);
  assert.equal(told, 1, 'the person is told once, not at every look');
  assert.equal(sleeps, 3);
});

test('an agent still busy at the limit means NOT sent: false, never a silent paste', async () => {
  let t = 0;
  const free = await waitForFreePane({
    capture: () => WORKING, sleep: async (ms) => { t += ms; }, now: () => t, maxMs: 10_000, everyMs: 2000,
  });
  assert.equal(free, false);
  assert.ok(t >= 10_000, 'it waited the whole limit');
});
