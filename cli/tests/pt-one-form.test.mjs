// Portuguese speaks to the person in one form, «tu» (escolhe, o teu orçamento), as most of the catalogs already did. Giro Mac
// build11: `jht team status` said «gastou … do seu orçamento» (the CLI's own texts) and, two lines below, «do teu orçamento»
// (the Capitano's notice, from shared/locales). The forms of «você» a person would read are refused here, in both catalogs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CATALOGS } from '../src/lib/texts.js';

const shared = JSON.parse(readFileSync(new URL('../../shared/locales/pt.json', import.meta.url), 'utf8'));

// an order to the person in the form of «você», at the start of a sentence or after «depois»/«e»/«ou»
const ORDERS = ['Aumente', 'Atualize', 'Carregue', 'Cole', 'Corrija', 'Crie', 'Defina', 'Dê', 'Escreva', 'Execute', 'Faça',
  'Ligue', 'Obtenha', 'Passe', 'Reinicie', 'Responda', 'Tente', 'Veja', 'Verifique', 'Volte', 'Arranque'];
const ORDER = new RegExp(`(?:^|[.:;!?(]\\s*|\\b(?:depois|e|ou)\\s+)(?:${ORDERS.join('|')})(?![\\p{L}])`, 'iu');
// «você» itself, and «seu/sua» when it is the person's (their budget, team, key, message, CLI, Telegram)
const YOU = /\b(?:você|vocês)\b|\b(?:seu|sua)\s+(?:orçamento|equipa|chave|mensagem|CLI|Telegram|variável)\b|à sua espera|a sua segue/iu;

function offenders(catalog) {
  return Object.entries(catalog).filter(([, text]) => typeof text === 'string' && (ORDER.test(text) || YOU.test(text)));
}

test('the CLI speaks Portuguese with «tu»', () => {
  assert.deepEqual(offenders(CATALOGS.pt), []);
});

test('the shared catalog speaks Portuguese with «tu»', () => {
  assert.deepEqual(offenders(shared), []);
});

test('the rule sees the forms of «você» it is there for', () => {
  for (const text of ['A equipa está em pausa: gastou $2 do seu orçamento de $3.', 'Cole a chave (uma linha).',
    'Nada foi guardado. Obtenha a chave de novo e depois execute: jht setup', 'Ligue a equipa com: jht team start',
    '(ainda a responder à sua mensagem anterior)', 'Dê-lhe a chave certa']) {
    assert.equal(offenders({ k: text }).length, 1, text);
  }
  // «its» is still «seu», and a subjunctive is not an order
  for (const text of ['as integrações e o seu estado', 'quem faça a revisão final', 'A escolha do runtime', 'Escolha inválida',
    'A aguardar que CAPITANO esteja pronto']) {
    assert.deepEqual(offenders({ k: text }), [], text);
  }
});
