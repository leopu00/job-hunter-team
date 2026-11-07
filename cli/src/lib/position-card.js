// Presentation only: the DB response and the fenced Python agent view stay intact.
import { stripVTControlCharacters } from 'node:util';
import { t, tf, currentLang } from '../../wizard/i18n.js';
import { SCORE_COMPONENT_LIMITS } from './score-ranges.js';

const label = (key) => t(`position_card.${key}`);

export function humanPositionText(value, { singleLine = false } = {}) {
  const text = stripVTControlCharacters(String(value ?? ''))
    .replace(/⟦\/?(?:EXT|DATI_ESTERNI)(?:·[^⟧]*)?⟧/g, '')
    .replace(/⟦\/?MARCATORE_ESTERNO_ESCAPED⟧/g, '')
    .replace(/\r\n|\\r\\n|\\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\t/g, ' ')
    .trim();
  return singleLine ? text.replace(/\s+/g, ' ') : text;
}

export function translatedValue(value) {
  const text = humanPositionText(value, { singleLine: true });
  if (!text) return label('unknown');
  const key = `position_card.value.${text}`;
  const translated = t(key);
  return translated === key ? text : translated;
}

function readableAnalysis(value) {
  return humanPositionText(value).replace(/\b[A-Z][A-Z_]{2,}\b|\bno_data_default\b/g, (token) => {
    const key = `position_card.token.${token}`;
    const translated = t(key);
    return translated === key ? token : translated;
  });
}

export function wrap(text, width = 86) {
  return text.split('\n').map((line) => {
    const lines = [];
    let current = '';
    for (const word of line.split(/\s+/).filter(Boolean)) {
      if (current && current.length + word.length + 1 > width) {
        lines.push(current);
        current = '';
      }
      current += (current ? ' ' : '') + word;
    }
    lines.push(current);
    return lines.join('\n');
  }).join('\n');
}

export function section(title, text) {
  return text ? `\n${label(title)}\n${wrap(text)}\n` : '';
}

function salary(row) {
  const groups = ['declared', 'estimated'].flatMap((kind) => {
    const lo = row[`salary_${kind}_min`];
    const hi = row[`salary_${kind}_max`];
    if (lo == null && hi == null) return [];
    const number = (value) => value == null ? '?' : Number(value).toLocaleString(currentLang());
    const range = lo === hi ? number(lo) : `${number(lo)}–${number(hi)}`;
    return [`${range} ${humanPositionText(row[`salary_${kind}_currency`] || 'EUR', { singleLine: true })}` +
      (kind === 'estimated' ? ` (${label('estimated')})` : '')];
  });
  return groups.join(' · ');
}

function shortReasons(text, full) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (full) return lines.join('\n');
  return lines.slice(0, 6).map((line) => line.length > 320 ? `${line.slice(0, 317)}…` : line).join('\n');
}

function analysis(row, full) {
  const positive = [row.score_breakdown, row.score_notes].filter(Boolean);
  const cautions = [];
  const metadata = [];
  let caution = false;
  for (const line of humanPositionText(row.notes).split('\n')) {
    if (/^\s*(NOTE_MISMATCH|EXCLUDED)\s*:/.test(line)) caution = true;
    else if (/^\s*[A-Z_]+\s*:/.test(line)) caution = false;
    if (caution) cautions.push(line);
    else if (/^\s*[A-Z_]+\s*:/.test(line)) metadata.push(line);
    else if (line.trim()) positive.push(line);
  }
  const reasons = readableAnalysis(positive.join('\n'));
  return section('reasons', shortReasons(reasons, full) || label('no_reasons')) +
    section('cautions', shortReasons(readableAnalysis(cautions.join('\n')), full)) +
    (full ? section('analysis', readableAnalysis(metadata.join('\n'))) : '');
}

function scoreDetails(row) {
  const lines = Object.entries(SCORE_COMPONENT_LIMITS).map(([key, max]) => {
    const value = row[key];
    const shown = typeof value === 'number' && Number.isFinite(value)
      ? `${Math.round(value / max * 100)}/100 (${value}/${max})`
      : label('unknown');
    return `${label(key)}: ${shown}`;
  });
  return section('scores', lines.join('\n'));
}

function technicalDetails(row) {
  const fields = [
    'id', 'company_id', 'status', 'source', 'found_by', 'found_at', 'role_family',
    'c_hq_country', 'company_verdict', 'app_status', 'written_at', 'applied_at',
    'applied_via', 'response', 'response_at', 'critic_verdict', 'critic_score',
    'cv_path', 'cl_path', 'cv_pdf_path', 'cl_pdf_path',
  ];
  return section('details', fields.filter((key) => row[key] != null && row[key] !== '')
    .map((key) => `${label(key)}: ${translatedValue(row[key])}`).join('\n'));
}

export function renderPositionCard(row, { full = false } = {}) {
  if (row === null) return `${label('not_found')}\n`;
  const text = (key) => humanPositionText(row[key], { singleLine: true }) || label('unknown');
  const score = typeof row.total_score === 'number' ? `${row.total_score}/100` : label('not_scored');
  const lines = [text('title'), text('company'), `${label('score')}: ${score}`,
    `${label('location')}: ${text('location')} · ${translatedValue(row.work_mode || row.remote_type)}`];
  const pay = salary(row);
  if (pay) lines.push(`${label('salary')}: ${pay}`);
  if (row.url) lines.push(`${label('link')}: ${text('url')}`);
  let card = `${lines.join('\n')}\n${analysis(row, full)}`;
  if (full) {
    card += scoreDetails(row) + section('description', humanPositionText(row.jd_text)) +
      section('requirements', humanPositionText(row.requirements)) + technicalDetails(row);
  } else {
    card += `\n${tf('position_card.more', text('id'), text('id'))}\n`;
  }
  return card;
}
