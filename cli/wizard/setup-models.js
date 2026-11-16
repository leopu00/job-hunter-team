import { effectiveSettings, validRoleModels } from '../src/lib/team-settings.js';
import { PI_API_MODELS, PROVIDER_ROLE_CLASS, piApiProvider } from '../../shared/runtime/provider-models.js';
import { ROLES, ROLE_DEFAULT_CLASS, ROLE_DEFAULT_EFFORT } from '../../shared/runtime/role-models.js';

/** The models of a team on pi with an API key (glm, kimi, claude): the ones the launcher gives each role, as the provider names them. */
function piRoleModels(config, roles) {
  const provider = typeof config.active_provider === 'string' ? piApiProvider(config.active_provider) : null;
  const models = provider ? PI_API_MODELS[provider] : null;
  if (config.harness !== 'pi' || !models || Object.keys(models).length === 0) return null;
  return Object.fromEntries(ROLES.map((role) => {
    const set = roles[role] ?? {};
    const modelClass = set.model || PROVIDER_ROLE_CLASS[provider]?.[role] || ROLE_DEFAULT_CLASS[role];
    return [role, { modelName: models[modelClass] ?? modelClass, effort: set.effort ?? ROLE_DEFAULT_EFFORT[role] }];
  }));
}

/** Describe the launcher's per-role choices, never the unused provider-wide model. */
export function summarizeRoleModels(config) {
  const roles = config.team?.role_models ?? {};
  if (!validRoleModels(roles)) return 'Models: invalid team.role_models; correct the role settings before starting.';
  const effective = piRoleModels(config, roles) ?? effectiveSettings(config, roles).effective;
  if (!effective) return '';
  return ['Models by role:', ...Object.entries(effective).map(
    ([role, { modelName, effort }]) => `  ${role}: ${modelName} (${effort})`,
  )].join('\n');
}
