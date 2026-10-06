import { test } from '@japa/runner'
import {
  legacyAssignmentRows,
  legacyInstanceRoleKey,
  legacyTeamRoleKey,
} from '#services/rbac/legacy'

test.group('RBAC legacy conversion', () => {
  test('old roles map to the default roles', ({ assert }) => {
    assert.equal(legacyInstanceRoleKey('SUPERADMIN'), 'owner')
    assert.equal(legacyInstanceRoleKey('USER'), 'member')
    assert.equal(legacyInstanceRoleKey(null), 'member')
    assert.equal(legacyTeamRoleKey('OWNER'), 'maintainer')
    assert.equal(legacyTeamRoleKey('MEMBER'), 'developer')
    assert.equal(legacyTeamRoleKey(null), 'developer')
  })

  test('one instance row per user, one team row per membership', ({ assert }) => {
    const now = new Date()
    const rows = legacyAssignmentRows(
      [
        { id: 'usr_a', system_role: 'SUPERADMIN' },
        { id: 'usr_b', system_role: 'USER' },
      ],
      [{ user_id: 'usr_b', team_id: 'team_1', role: 'OWNER' }],
      now
    )
    assert.deepEqual(
      rows.map(({ user_id, role_id, scope_type, scope_id }) => ({
        user_id,
        role_id,
        scope_type,
        scope_id,
      })),
      [
        { user_id: 'usr_a', role_id: 'role_owner', scope_type: 'instance', scope_id: null },
        { user_id: 'usr_b', role_id: 'role_member', scope_type: 'instance', scope_id: null },
        { user_id: 'usr_b', role_id: 'role_maintainer', scope_type: 'team', scope_id: 'team_1' },
      ]
    )
    assert.isTrue(rows.every((row) => row.id.startsWith('ra_') && row.created_at === now))
  })
})
