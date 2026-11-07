import { effectiveSettings, validRoleModels } from '../src/lib/team-settings.js';

/** Describe the launcher's per-role choices, never the unused provider-wide model. */
export function summarizeRoleModels(config) {
  const roles = config.team?.role_models ?? {};
  if (!validRoleModels(roles)) return 'Models: invalid team.role_models; correct the role settings before starting.';
  const { effective } = effectiveSettings(config, roles);
  if (!effective) return '';
  return ['Models by role:', ...Object.entries(effective).map(
    ([role, { modelName, effort }]) => `  ${role}: ${modelName} (${effort})`,
  )].join('\n');
}
