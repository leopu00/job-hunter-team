import { t, tf } from '../../wizard/i18n.js';
import { humanPositionText, translatedValue, section, wrap } from './position-card.js';

const text = (value) => humanPositionText(value, { singleLine: true });
const label = (key) => t(`position_card.dashboard.${key}`);

export function validDashboard(value) {
  const count = (number) => Number.isSafeInteger(number) && number >= 0;
  const record = (object) => object && typeof object === 'object' && !Array.isArray(object);
  return record(value) && count(value.total) && count(value.positions_with_company_id) &&
    record(value.by_status) && Object.values(value.by_status).every(count) &&
    record(value.companies_by_verdict) && Object.values(value.companies_by_verdict).every(count) &&
    Array.isArray(value.top_scores) && value.top_scores.every((row) => record(row) && row.id != null) &&
    Array.isArray(value.applications) && value.applications.every(record);
}

function rankedPositions(data) {
  if (data.top_scores.length === 0) return label('no_scores');
  return data.top_scores.map((row, index) => {
    const score = typeof row.total_score === 'number' ? `${row.total_score}/100` : t('position_card.not_scored');
    const application = data.applications.find((item) => String(item.position_id) === String(row.id));
    const verdict = application?.critic_verdict;
    const review = verdict ? ` · ${t('position_card.critic_verdict')}: ${translatedValue(verdict)}` : '';
    return `${index + 1}. #${text(row.id)} · ${text(row.title)}\n` +
      `   ${text(row.company)} · ${score} · ${translatedValue(row.status)}${review}\n` +
      `   jht positions show ${text(row.id)}`;
  }).join('\n\n');
}

function technicalSummary(data) {
  const stages = Object.entries(data.by_status)
    .map(([status, count]) => `${translatedValue(status)}: ${count}`).join('\n');
  const companies = Object.entries(data.companies_by_verdict)
    .map(([verdict, count]) => `${translatedValue(verdict)}: ${count}`).join('\n');
  const applications = data.applications.map((row) =>
    `#${text(row.position_id)} · ${text(row.title)} · ${text(row.company)} · ${translatedValue(row.status)}` +
    (row.critic_verdict ? ` · ${t('position_card.critic_verdict')}: ${translatedValue(row.critic_verdict)}` : '') +
    (row.applied_at ? ` · ${t('position_card.applied_at')}: ${text(row.applied_at)}` : ''));
  return section('dashboard.stages', stages) + section('dashboard.company_assessments', companies) +
    section('dashboard.applications', applications.join('\n')) +
    section('dashboard.coverage', `${data.positions_with_company_id}/${data.total} ` +
      `(${data.total ? Math.floor(100 * data.positions_with_company_id / data.total) : 0}%)`);
}

export function renderPositionsDashboard(data, { full = false } = {}) {
  const pending = (data.by_status.new || 0) + (data.by_status.checked || 0);
  // The unchanged machine query returns at most ten scored offers. Never claim
  // ten is the total when the database might hold more.
  const scored = data.top_scores.length < 10 ? String(data.top_scores.length)
    : tf('position_card.dashboard.at_least', data.top_scores.length);
  const summary = [label('title'), tf('position_card.dashboard.found', data.total),
    tf('position_card.dashboard.pending', pending), tf('position_card.dashboard.scored', scored)];
  let output = `${summary.join('\n')}\n` + section('dashboard.ranked', rankedPositions(data));
  output += `\n${wrap(tf('position_card.dashboard.linked', data.positions_with_company_id, data.total))}\n`;
  if (full) output += technicalSummary(data);
  else output += `\n${label('more')}\n`;
  return output;
}
