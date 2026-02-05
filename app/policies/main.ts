export const policies = {
  System: () => import('#policies/system_policy'),
  Team: () => import('#policies/team_policy'),
  Project: () => import('#policies/project_policy'),
}
