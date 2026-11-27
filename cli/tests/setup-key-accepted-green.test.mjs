// JHT-T352 (collaudo W1 26/11): the accepted API key was said in the grey of a note, and the person could not tell whether it was
// fine. Now it is said with clack's green check; a prompter without `success` says it as a note, as before. Made-up key.
process.env.FORCE_COLOR = '1';
import assert from 'node:assert/strict';
import test from 'node:test';

const { askPiApiKey } = await import('../wizard/setup-api-key.js');
const { createClackPrompter } = await import('../wizard/clack-prompter.js');

const t = (key) => key;
const tf = (key, ...args) => `${key}(${args.join(',')})`;
const choice = { value: 'claude', label: 'Claude' };
const valid = async () => ({ state: 'valid', label: 'Claude (Anthropic)' });

function prompter(withSuccess) {
  const said = [];
  const p = {
    password: async () => 'sk-ant-FAKEFAKEFAKEFAKEFAKE0123456789',
    note: async (message) => { said.push(['note', message]); },
  };
  if (withSuccess) p.success = async (message) => { said.push(['success', message]); };
  return { p, said };
}

test('an accepted key is a success, not a note', async () => {
  const { p, said } = prompter(true);
  await askPiApiKey(p, { t, tf, choice, check: valid, store: () => ({ kept: true }) });
  assert.deepEqual(said.filter(([kind]) => kind === 'success').map(([, m]) => m), ['wizard.key.accepted(Claude (Anthropic))']);
  assert.equal(said.some(([kind, m]) => kind === 'note' && m.startsWith('wizard.key.accepted')), false);
});

test('a prompter without success still says it', async () => {
  const { p, said } = prompter(false);
  await askPiApiKey(p, { t, tf, choice, check: valid, store: () => ({ kept: true }) });
  assert.ok(said.some(([kind, m]) => kind === 'note' && m.startsWith('wizard.key.accepted')));
});

test('the clack prompter says a success in green, with its check', async () => {
  const written = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => { written.push(String(chunk)); return true; };
  try {
    await createClackPrompter().success('Claude accepted the API key.');
  } finally {
    process.stdout.write = write;
  }
  const out = written.join('');
  assert.match(out, /Claude accepted the API key\./);
  assert.match(out, /\x1b\[32m/, 'green');
});
