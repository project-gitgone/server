import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import ProjectKey from '#models/project_key'
import RoleAssignment from '#models/role_assignment'
import { createUser, grantRole } from '#tests/helpers/rbac'

test.group('Role assignments API', () => {
  test('an admin cannot promote to owner nor demote an owner', async ({ client }) => {
    const owner = await createUser('assign-owner@example.com')
    const admin = await createUser('assign-admin@example.com')
    const member = await createUser('assign-member@example.com')
    await grantRole(owner, 'owner')
    await grantRole(admin, 'admin')
    await grantRole(member, 'member')

    const response1 = await client
      .put(`/api/users/${member.id}/role`)
      .loginAs(admin)
      .json({ roleId: 'role_owner' })
    response1.assertStatus(403)
    const response2 = await client
      .put(`/api/users/${owner.id}/role`)
      .loginAs(admin)
      .json({ roleId: 'role_member' })
    response2.assertStatus(403)
    const response3 = await client
      .put(`/api/users/${member.id}/role`)
      .loginAs(admin)
      .json({ roleId: 'role_admin' })
    response3.assertStatus(200)
  })

  test('the last owner cannot demote themselves', async ({ client }) => {
    const owner = await createUser('last-owner@example.com')
    await grantRole(owner, 'owner')
    const response = await client
      .put(`/api/users/${owner.id}/role`)
      .loginAs(owner)
      .json({ roleId: 'role_member' })
    response.assertStatus(422)
  })

  test('a workspace role cannot be assigned on the instance', async ({ client }) => {
    const owner = await createUser('scope-owner@example.com')
    const member = await createUser('scope-member@example.com')
    await grantRole(owner, 'owner')
    await grantRole(member, 'member')
    const response = await client
      .put(`/api/users/${member.id}/role`)
      .loginAs(owner)
      .json({ roleId: 'role_developer' })
    response.assertStatus(422)
  })

  test('the last team maintainer cannot become a developer', async ({ client }) => {
    const team = await Team.create({ name: 'Guarded' })
    const maintainer = await createUser('guard-maintainer@example.com')
    await grantRole(maintainer, 'maintainer', { team })
    const response = await client
      .patch(`/api/teams/${team.id}/members/${maintainer.id}`)
      .loginAs(maintainer)
      .json({ roleId: 'role_developer' })
    response.assertStatus(422)
  })

  test('granting then revoking a project role, with key revocation', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Project members' })
    const project = await Project.create({ name: 'Shared', teamId: team.id })
    const maintainer = await createUser('pm-maintainer@example.com')
    const guest = await createUser('pm-guest@example.com')
    await grantRole(maintainer, 'maintainer', { team })

    const granted = await client
      .put(`/api/projects/${project.id}/members`)
      .loginAs(maintainer)
      .json({ email: guest.email, roleId: 'role_viewer' })
    granted.assertStatus(200)

    const listed = await client.get(`/api/projects/${project.id}/members`).loginAs(maintainer)
    assert.sameDeepMembers(
      listed.body().map((m: any) => ({ userId: m.userId, source: m.source })),
      [
        { userId: maintainer.id, source: 'team' },
        { userId: guest.id, source: 'project' },
      ]
    )

    await ProjectKey.create({ projectId: project.id, userId: guest.id, encryptedKey: 'k' })
    const revoked = await client
      .delete(`/api/projects/${project.id}/members/${guest.id}`)
      .loginAs(maintainer)
    revoked.assertStatus(200)
    assert.deepEqual(
      revoked.body().projectsToRotate.map((p: any) => p.id),
      [project.id]
    )
    assert.isNull(await ProjectKey.query().where('user_id', guest.id).first())
  })

  test('changing a team role keeps the key when the user can still read', async ({
    client,
    assert,
  }) => {
    const team = await Team.create({ name: 'Downgrade' })
    const project = await Project.create({ name: 'Kept', teamId: team.id })
    const maintainer = await createUser('dg-maintainer@example.com')
    const dev = await createUser('dg-dev@example.com')
    await grantRole(maintainer, 'maintainer', { team })
    await grantRole(dev, 'developer', { team })
    await ProjectKey.create({ projectId: project.id, userId: dev.id, encryptedKey: 'k' })

    const response = await client
      .patch(`/api/teams/${team.id}/members/${dev.id}`)
      .loginAs(maintainer)
      .json({ roleId: 'role_viewer' })
    response.assertStatus(200)
    assert.deepEqual(response.body().projectsToRotate, [])
    assert.isNotNull(await ProjectKey.query().where('user_id', dev.id).first())
    const assignment = await RoleAssignment.query()
      .where('user_id', dev.id)
      .where('scope_id', team.id)
      .firstOrFail()
    assert.equal(assignment.roleId, 'role_viewer')
  })
})
