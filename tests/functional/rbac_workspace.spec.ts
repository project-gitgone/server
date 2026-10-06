import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import RoleAssignment from '#models/role_assignment'
import { createUser, grantRole } from '#tests/helpers/rbac'

test.group('RBAC workspace', () => {
  test('the creator of a team becomes its maintainer', async ({ client, assert }) => {
    const user = await createUser('creator@example.com')
    await grantRole(user, 'member')
    const response = await client.post('/api/teams').loginAs(user).json({ name: 'Created Team' })
    response.assertStatus(201)
    const assignment = await RoleAssignment.query()
      .where('scope_type', 'team')
      .where('scope_id', response.body().id)
      .firstOrFail()
    assert.equal(assignment.roleId, 'role_maintainer')
  })

  test('old clients adding an OWNER get a maintainer', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Legacy Team' })
    const maintainer = await createUser('legacy-maintainer@example.com')
    const newcomer = await createUser('legacy-new@example.com')
    await grantRole(maintainer, 'maintainer', { team })

    const response = await client
      .post(`/api/teams/${team.id}/members`)
      .loginAs(maintainer)
      .json({ email: newcomer.email, role: 'OWNER' })
    response.assertStatus(201)
    const assignment = await RoleAssignment.query()
      .where('user_id', newcomer.id)
      .where('scope_id', team.id)
      .firstOrFail()
    assert.equal(assignment.roleId, 'role_maintainer')
  })

  test('a developer cannot add members', async ({ client }) => {
    const team = await Team.create({ name: 'Dev Team' })
    const dev = await createUser('dev-add@example.com')
    await grantRole(dev, 'developer', { team })
    const response = await client
      .post(`/api/teams/${team.id}/members`)
      .loginAs(dev)
      .json({ email: 'x@example.com' })
    response.assertStatus(403)
  })

  test('/me keeps the legacy role of each team', async ({ client, assert }) => {
    const user = await createUser('me@example.com')
    const managed = await Team.create({ name: 'Managed' })
    const joined = await Team.create({ name: 'Joined' })
    await grantRole(user, 'member')
    await grantRole(user, 'maintainer', { team: managed })
    await grantRole(user, 'viewer', { team: joined })

    const response = await client.get('/api/auth/me').loginAs(user)
    response.assertStatus(200)
    const teams = Object.fromEntries(response.body().teams.map((t: any) => [t.name, t.role]))
    assert.deepEqual(teams, { Managed: 'OWNER', Joined: 'MEMBER' })
    assert.equal(response.body().instanceRole.key, 'member')
    assert.include(response.body().permissions, 'instance.teams.create')
  })

  test('projects are listed through team and project roles', async ({ client, assert }) => {
    const user = await createUser('lister@example.com')
    const team = await Team.create({ name: 'Listed Team' })
    const fromTeam = await Project.create({ name: 'From team', teamId: team.id })
    const otherTeam = await Team.create({ name: 'Other' })
    const hiddenTeam = await Team.create({ name: 'Hidden team' })
    const direct = await Project.create({ name: 'Direct', teamId: otherTeam.id })
    await Project.create({ name: 'Hidden', teamId: hiddenTeam.id })
    await grantRole(user, 'viewer', { team })
    await grantRole(user, 'viewer', { project: direct })

    const response = await client.get('/api/projects').loginAs(user)
    response.assertStatus(200)
    assert.sameMembers(
      response.body().map((p: any) => p.id),
      [fromTeam.id, direct.id]
    )
  })

  test('creating a user gives the member role, systemRole SUPERADMIN needs an owner', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('user-admin@example.com')
    await grantRole(admin, 'admin')

    const created = await client
      .post('/api/users')
      .loginAs(admin)
      .json({ email: 'new-user@example.com', fullName: 'New User' })
    created.assertStatus(201)
    const assignment = await RoleAssignment.query()
      .where('user_id', created.body().user.id)
      .where('scope_type', 'instance')
      .firstOrFail()
    assert.equal(assignment.roleId, 'role_member')

    const promoted = await client
      .post('/api/users')
      .loginAs(admin)
      .json({ email: 'new-owner@example.com', fullName: 'New Owner', systemRole: 'SUPERADMIN' })
    promoted.assertStatus(403)
  })

  test('the first user of the instance becomes its owner', async ({ client, assert }) => {
    const response = await client.post('/api/setup/init-admin').json({
      email: 'first@example.com',
      fullName: 'First',
      authKey: 'k'.repeat(43),
      kdf: { algo: 'scrypt', salt: 'c2FsdHNhbHRzYWx0c2FsdA==', N: 131072, r: 8, p: 1 },
      publicKey: 'pub',
      encryptedPrivateKey: 'priv',
    })
    response.assertStatus(201)
    const assignment = await RoleAssignment.query()
      .where('user_id', response.body().user.id)
      .firstOrFail()
    assert.equal(assignment.roleId, 'role_owner')
  })
})
