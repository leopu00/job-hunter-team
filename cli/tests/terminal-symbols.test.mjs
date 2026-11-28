import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { usesUnicode, asciiSymbols, installTerminalSymbols } from '../src/lib/terminal-symbols.js';
import { CHAT_COMMAND, WINDOWS_CHAT_COMMAND, setupOutro } from '../wizard/setup-outro.js';

test('unknown Windows consoles default to ASCII, recognized terminals keep Unicode, either can be forced', () => {
  for (const env of [{}, { CI: '1' }, { TERM: 'xterm-256color' }, { PSModulePath: 'PowerShell/7' }]) {
    assert.equal(usesUnicode(env, 'win32'), false);
    assert.equal(usesUnicode({ ...env, JHT_UNICODE: '1' }, 'win32'), true);
  }
  for (const env of [{ WT_SESSION: 'test' }, { TERM_PROGRAM: 'vscode' }, { TERM_PROGRAM: 'WezTerm' }]) {
    assert.equal(usesUnicode(env, 'win32'), true);
    assert.equal(usesUnicode({ ...env, JHT_UNICODE: '0' }, 'win32'), false);
  }
  assert.equal(usesUnicode({}, 'darwin'), true);
  assert.equal(usesUnicode({}, 'linux'), true);
  assert.equal(usesUnicode({ TERM: 'linux' }, 'linux'), false);
  assert.equal(usesUnicode({ JHT_TERMINAL_PLATFORM: 'win32' }), false);
  assert.equal(usesUnicode({ JHT_TERMINAL_PLATFORM: 'win32', JHT_UNICODE: '1' }), true);
});

test('ASCII decoration keeps accented translations and ANSI controls', () => {
  assert.equal(asciiSymbols('\x1b[32m✓ Caffè, déjà, költség\x1b[0m'), '\x1b[32m[x] Caffè, déjà, költség\x1b[0m');
  assert.equal(asciiSymbols('◆ ◇ │ ─ ◼'), '> - | - [x]');
  assert.equal(asciiSymbols('✏️⏱️🌙📅♾️'), '');
  assert.equal(asciiSymbols('⠋'), '*');
  assert.equal(asciiSymbols('—–◐◑◒◓'), '--****');
});

function sink(isTTY = true) {
  return { isTTY, chunks: [], write(chunk, ...args) { this.chunks.push([chunk, ...args]); return false; } };
}

test('TTY writes preserve callbacks, backpressure, buffers and install only once; pipes and JSON remain untouched', () => {
  const tty = sink(), pipe = sink(false);
  const options = { env: { JHT_UNICODE: '0' }, streams: [tty, pipe], argv: [] };
  installTerminalSymbols(options);
  const write = tty.write;
  installTerminalSymbols(options);
  assert.equal(tty.write, write);
  const callback = () => {};
  assert.equal(tty.write('✓', 'utf8', callback), false);
  assert.deepEqual(tty.chunks[0], ['[x]', 'utf8', callback]);
  const buffer = Buffer.from('✓');
  tty.write(buffer);
  assert.equal(tty.chunks[1][0], buffer);
  pipe.write('✓');
  assert.equal(pipe.chunks[0][0], '✓');
  for (const argv of [['--json'], ['status', '--json=true']]) {
    const json = sink();
    installTerminalSymbols({ ...options, streams: [json], argv });
    json.write('{"label":"✓"}');
    assert.equal(json.chunks[0][0], '{"label":"✓"}');
  }
  const unicode = sink();
  installTerminalSymbols({ ...options, env: { JHT_UNICODE: '1' }, streams: [unicode] });
  unicode.write('✓ 📅');
  assert.equal(unicode.chunks[0][0], '✓ 📅');
});

test('real clack rendering through a fake console: prompts, notes, spinner, success and cancellation', () => {
  const script = `
    import { PassThrough } from 'node:stream';
    import { syncBuiltinESMExports } from 'node:module';
    import { installTerminalSymbols } from './src/lib/terminal-symbols.js';
    Object.defineProperty(process, 'platform', { value: process.env.TEST_CONSOLE_PLATFORM });
    const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
    Object.defineProperty(process, 'stdin', { value: input });
    syncBuiltinESMExports();
    Object.defineProperty(process.stdout, 'isTTY', { value: true });
    Object.defineProperty(process.stdout, 'columns', { value: 80 });
    Object.defineProperty(process.stdout, 'rows', { value: 24 });
    await import('./src/lib/terminal-init.js');
    installTerminalSymbols({ argv: [] });
    const { createClackPrompter } = await import('./wizard/clack-prompter.js');
    const { cancel } = await import('@clack/prompts');
    const p = createClackPrompter();
    await p.intro('Setup');
    await p.note('Budget ⏱️ 🌙 📅 ✏️ ♾️', 'Choices');
    const select = p.select({ message: 'Budget', options: [{ value: 'daily', label: '📅 Daily' }] });
    setTimeout(() => input.write('\\r'), 30);
    if (await select !== 'daily') throw new Error('selection changed');
    const spin = p.progress('Working');
    await new Promise(resolve => setTimeout(resolve, 100)); spin.stop('Ready');
    await p.success('✓ Saved'); await p.outro('Done'); cancel('Cancelled');
  `;
  for (const platform of ['win32', 'darwin']) for (const mode of ['0', '1']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../', import.meta.url), env: { ...process.env, TEST_CONSOLE_PLATFORM: platform, JHT_UNICODE: mode },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout;
    assert.match(output, /Saved/);
    assert.match(output, /Cancelled/);
    if (mode === '0') {
      assert.doesNotMatch(output, /[^\x00-\x7f]/u);
      assert.match(output, /\[x\] Saved/);
    } else {
      assert.match(output, /📅/u);
      assert.match(output, /✓ Saved/u);
      assert.match(output, /│/u, 'forced Unicode also reaches clack framing');
    }
  }
});

test('all final setup messages in every language offer a PATH reload before chat on Windows', () => {
  for (const lang of ['en', 'it', 'de', 'es', 'fr', 'hu', 'pt']) {
    const texts = JSON.parse(readFileSync(new URL(`../../shared/locales/${lang}.json`, import.meta.url), 'utf8'));
    for (const key of ['wizard.outro_done', 'wizard.outro_done_running', 'wizard.outro_no_credit']) {
      const windows = setupOutro(texts[key], 'win32');
      assert.ok(windows.includes(WINDOWS_CHAT_COMMAND), `${lang} ${key}`);
      if (texts[key].includes(CHAT_COMMAND)) {
        assert.equal(windows.replace(WINDOWS_CHAT_COMMAND, CHAT_COMMAND), texts[key]);
      } else {
        assert.equal(windows, `${texts[key]}\n  ${WINDOWS_CHAT_COMMAND}`);
      }
      assert.equal(setupOutro(texts[key], 'linux'), texts[key]);
      assert.equal(setupOutro(texts[key], 'darwin'), texts[key]);
    }
  }
});

test('the host metadata wins over the Linux container platform for the setup outro', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { setupOutro } from './wizard/setup-outro.js';
    console.log(setupOutro('Answer: jht team chat assistente'));
  `], { cwd: new URL('../', import.meta.url), env: { ...process.env, JHT_TERMINAL_PLATFORM: 'win32' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `Answer: ${WINDOWS_CHAT_COMMAND}`);
});
