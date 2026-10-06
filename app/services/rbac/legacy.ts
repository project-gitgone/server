import { nanoid } from 'nanoid'
import { defaultRoleId, type DefaultRoleKey } from '#services/rbac/default_roles'

export const legacyInstanceRoleKey = (systemRole: string | null | undefined): DefaultRoleKey =>
  systemRole === 'SUPERADMIN' ? 'owner' : 'member'

export const legacyTeamRoleKey = (role: string | null | undefined): DefaultRoleKey =>
  role === 'OWNER' ? 'maintainer' : 'developer'

export function legacyAssignmentRows(
  users: { id: string; system_role: string | null }[],
  members: { user_id: string; team_id: string; role: string | null }[],
  now: Date
) {
  const row = (
    userId: string,
    key: DefaultRoleKey,
    scopeType: 'instance' | 'team',
    scopeId: string | null
  ) => ({
    id: `ra_${nanoid(12)}`,
    user_id: userId,
    role_id: defaultRoleId(key),
    scope_type: scopeType,
    scope_id: scopeId,
    created_at: now,
  })
  return [
    ...users.map((u) => row(u.id, legacyInstanceRoleKey(u.system_role), 'instance', null)),
    ...members.map((m) => row(m.user_id, legacyTeamRoleKey(m.role), 'team', m.team_id)),
  ]
}
