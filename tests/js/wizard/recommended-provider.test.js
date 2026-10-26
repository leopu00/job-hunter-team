import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AI_PROVIDERS, RECOMMENDED_PROVIDER } from '../../../cli/wizard/setup-helpers.js';

// Codex è il provider consigliato del prodotto open source (abbonamento
// ChatGPT di ciascuno): primo nel wizard, default quando non si sceglie,
// «consigliato» nell'etichetta in ogni lingua. È l'unico offerto: Claude e Kimi sono
// archiviati (0.4) e il codice resta solo per le squadre già configurate.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const RECOMMENDED = {
  it: 'consigliato', en: 'recommended', es: 'recomendado', fr: 'recommandé',
  de: 'empfohlen', pt: 'recomendado', hu: 'ajánlott',
};

describe('Codex consigliato nella CLI', () => {
  it('è l’unico e il default del wizard, senza Claude né Kimi', () => {
    expect(RECOMMENDED_PROVIDER).toBe('openai');
    expect(AI_PROVIDERS.map((p) => p.value)).toEqual(['openai']);
    expect(AI_PROVIDERS[0].label).toContain('Codex');
  });

  it('ha «consigliato» nell’etichetta di Codex in tutte e 7 le lingue, e nessuna lingua offre più Claude né Kimi', () => {
    for (const [lang, word] of Object.entries(RECOMMENDED)) {
      const locale = JSON.parse(read(`shared/locales/${lang}.json`));
      expect(locale['wizard.provider.codex'], lang).toContain(word);
      expect(locale['wizard.provider.kimi'], lang).toBeUndefined();
      expect(locale['wizard.provider.claude'], lang).toBeUndefined();
    }
  });

  it('usa Codex quando nessuno sceglie: jht setup, il setup non interattivo, doctor e providers', () => {
    expect(read('cli/src/commands/setup.js')).toContain("t('wizard.cli.provider'), 'openai')");
    expect(read('cli/wizard/setup-noninteractive.js')).toContain('opts.provider || RECOMMENDED_PROVIDER');
    expect(read('cli/src/commands/doctor.js')).toContain('jht providers use codex (recommended');
    const providers = read('cli/src/commands/providers.js');
    const known = providers.slice(providers.indexOf('const KNOWN_PROVIDERS = {'));
    expect(known.indexOf('openai:')).toBeLessThan(known.indexOf('anthropic:'));
    expect(providers).toContain("const UPDATE_TARGETS = ['codex'];");
    expect(providers).toContain('Recommended: jht providers use codex');
  });
});
