import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import Role from '#models/role'
import RoleAssignment from '#models/role_assignment'
import Environment from '#models/environment'
import AuditEvent from '#models/audit_event'
import { createUser, grantRole } from '#tests/helpers/rbac'

test.group('Phase 2 hardening', () => {
  test('unprotecting an environment requires the right to write it while protected', async ({
    client,
  }) => {
    const team = await Team.create({ name: 'Unprotect' })
    const project = await Project.create({ name: 'Unprotect project', teamId: team.id })
    const manager = await createUser('env-manager@example.com')
    const role = await Role.create({
      name: 'Environment manager',
      scope: 'workspace',
      isSystem: false,
      grants: [
        { permission: 'project.environments.manage' },
        { permission: 'env.write', environments: { type: 'unprotected' } },
      ],
    } as any)
    await RoleAssignment.create({
      userId: manager.id,
      roleId: role.id,
      scopeType: 'project',
      scopeId: project.id,
    })
    const production = await Environment.create({
      projectId: project.id,
      name: 'production',
      protected: true,
    })

    const unprotect = await client
      .patch(`/api/projects/${project.id}/environments/${production.id}`)
      .loginAs(manager)
      .json({ protected: false })
    unprotect.assertStatus(403)

    const createdOpen = await client
      .post(`/api/projects/${project.id}/environments`)
      .loginAs(manager)
      .json({ name: 'live', protected: false })
    createdOpen.assertStatus(201)
    const createdProd = await client
      .post(`/api/projects/${project.id}/environments`)
      .loginAs(manager)
      .json({ name: 'prod', protected: false })
    createdProd.assertStatus(403)
  })

  test('security relevant changes and failed attempts are audited', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Audit gaps' })
    const project = await Project.create({ name: 'Audit gaps project', teamId: team.id })
    const maintainer = await createUser('gaps-maintainer@example.com')
    await grantRole(maintainer, 'maintainer', { team })

    const update = await client
      .patch(`/api/projects/${project.id}`)
      .loginAs(maintainer)
      .json({ disallowPull: true })
    update.assertStatus(200)

    const badLogin = await client
      .post('/api/auth/login')
      .json({ email: 'gaps-maintainer@example.com', password: 'wrong-password' })
    badLogin.assertStatus(401)

    const badToken = await client
      .get('/api/secrets/token')
      .header('Authorization', 'Bearer v2.tok_missing.secret')
    badToken.assertStatus(401)

    const events = await AuditEvent.query().orderBy('created_at')
    const actions = events.map((e) => e.action)
    assert.includeMembers(actions, ['projects.update', 'auth.login.failed', 'tokens.use.denied'])
  })

  test('creating a user with a role records the granted role', async ({ client, assert }) => {
    const owner = await createUser('create-with-role@example.com')
    await grantRole(owner, 'owner')
    const response = await client
      .post('/api/users')
      .loginAs(owner)
      .json({ email: 'new-admin@example.com', fullName: 'New Admin', roleId: 'role_admin' })
    response.assertStatus(201)

    const grant = await AuditEvent.query()
      .where('action', 'access.grant')
      .where('target_id', response.body().user.id)
      .firstOrFail()
    assert.equal(grant.details?.roleId, 'role_admin')
  })
})
