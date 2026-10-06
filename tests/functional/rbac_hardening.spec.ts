import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Team from '#models/team'
import Project from '#models/project'
import Role from '#models/role'
import RoleAssignment from '#models/role_assignment'
import { createUser, grantRole } from '#tests/helpers/rbac'

test.group('RBAC hardening', () => {
  test('an instance admin who cannot read a project cannot rotate its key', async ({ client }) => {
    const team = await Team.create({ name: 'Rotation guard' })
    const project = await Project.create({ name: 'Guarded', teamId: team.id })
    const admin = await createUser('rotate-admin@example.com')
    await grantRole(admin, 'admin')
    const response1 = await client.get(`/api/keys/${project.id}/snapshots`).loginAs(admin)
    response1.assertStatus(403)
    const rotate = await client
      .post(`/api/keys/${project.id}/rotate`)
      .loginAs(admin)
      .json({ expectedKeyVersion: 1, keys: [], snapshots: [] })
    rotate.assertStatus(403)
  })

  test('an admin cannot reset, edit or delete an owner', async ({ client }) => {
    const owner = await createUser('guarded-owner@example.com')
    const admin = await createUser('ambitious-admin@example.com')
    await grantRole(owner, 'owner')
    await grantRole(admin, 'admin')
    const reset = await client.post(`/api/users/${owner.id}/reset-credentials`).loginAs(admin)
    reset.assertStatus(403)
    const edit = await client
      .patch(`/api/users/${owner.id}`)
      .loginAs(admin)
      .json({ email: 'mine@example.com' })
    edit.assertStatus(403)
    const response2 = await client.delete(`/api/users/${owner.id}`).loginAs(admin)
    response2.assertStatus(403)
  })

  test('a deleted owner does not count as the remaining owner', async ({ client }) => {
    const active = await createUser('active-owner@example.com')
    const gone = await createUser('gone-owner@example.com')
    await grantRole(active, 'owner')
    await grantRole(gone, 'owner')
    gone.deletedAt = DateTime.now()
    await gone.save()

    const response = await client
      .put(`/api/users/${active.id}/role`)
      .loginAs(active)
      .json({ roleId: 'role_member' })
    response.assertStatus(422)
  })

  test('nobody can give themselves a role stronger than their own', async ({ client }) => {
    const team = await Team.create({ name: 'Escalation' })
    const project = await Project.create({ name: 'Escalation project', teamId: team.id })
    const manager = await createUser('members-manager@example.com')
    const role = await Role.create({
      name: 'Member manager',
      scope: 'workspace',
      isSystem: false,
      grants: [{ permission: 'team.members.manage' }],
    } as any)
    await RoleAssignment.create({
      userId: manager.id,
      roleId: role.id,
      scopeType: 'team',
      scopeId: team.id,
    })
    const admin = await createUser('escalating-admin@example.com')
    await grantRole(admin, 'admin')

    const selfPromotion = await client
      .patch(`/api/teams/${team.id}/members/${manager.id}`)
      .loginAs(manager)
      .json({ roleId: 'role_maintainer' })
    selfPromotion.assertStatus(403)

    const adminSelfGrant = await client
      .put(`/api/projects/${project.id}/members`)
      .loginAs(admin)
      .json({ email: admin.email, roleId: 'role_developer' })
    adminSelfGrant.assertStatus(403)
  })

  test('a team manager cannot hand out rights they do not hold, an instance admin can', async ({
    client,
  }) => {
    const team = await Team.create({ name: 'Delegation' })
    const manager = await createUser('delegating-manager@example.com')
    const newcomer = await createUser('delegated@example.com')
    const other = await createUser('delegated-by-admin@example.com')
    const admin = await createUser('delegating-admin@example.com')
    const role = await Role.create({
      name: 'Delegating manager',
      scope: 'workspace',
      isSystem: false,
      grants: [{ permission: 'team.members.manage' }],
    } as any)
    await RoleAssignment.create({
      userId: manager.id,
      roleId: role.id,
      scopeType: 'team',
      scopeId: team.id,
    })
    await grantRole(admin, 'admin')

    const byManager = await client
      .post(`/api/teams/${team.id}/members`)
      .loginAs(manager)
      .json({ email: newcomer.email, roleId: 'role_maintainer' })
    byManager.assertStatus(403)

    const byAdmin = await client
      .post(`/api/teams/${team.id}/members`)
      .loginAs(admin)
      .json({ email: other.email, roleId: 'role_developer' })
    byAdmin.assertStatus(201)
  })
})
