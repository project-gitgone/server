import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import Role from '#models/role'
import PermissionResolver, { usersWithPermission } from '#services/rbac/permission_resolver'
import { DEFAULT_ROLES } from '#services/rbac/default_roles'
import { createUser, grantRole } from '#tests/helpers/rbac'

test.group('RBAC resolver', () => {
  test('system roles are seeded and take their grants from the code', async ({ assert }) => {
    const developer = await Role.findOrFail('role_developer')
    assert.isTrue(developer.isSystem)
    assert.deepEqual(developer.effectiveGrants, DEFAULT_ROLES.developer.grants)
    assert.deepEqual(developer.serialize().grants, DEFAULT_ROLES.developer.grants)
  })

  test('custom roles take their grants from the database', async ({ assert }) => {
    const grants = [{ permission: 'env.read', environments: { type: 'all' } }]
    const role = await Role.create({
      name: 'Reader',
      scope: 'workspace',
      isSystem: false,
      grants,
    } as any)
    await role.refresh()
    assert.deepEqual(role.effectiveGrants, grants)
  })

  test('resolves rights from team and project assignments', async ({ assert }) => {
    const user = await createUser('resolver@example.com')
    const team = await Team.create({ name: 'Resolver Team' })
    const project = await Project.create({ name: 'Resolver Project', teamId: team.id })
    await grantRole(user, 'viewer', { team })
    await grantRole(user, 'developer', { project })

    const resolver = PermissionResolver.for(user)
    assert.isTrue(
      await resolver.can('env.write', {
        project,
        environment: { name: 'staging', protected: false },
      })
    )
    assert.isFalse(
      await resolver.can('env.write', {
        project,
        environment: { name: 'production', protected: true },
      })
    )
    assert.isTrue(await resolver.canSee({ teamId: team.id }))
    assert.deepEqual(await resolver.projectVisibility(), {
      all: false,
      teamIds: [team.id],
      projectIds: [project.id],
    })
  })

  test('lists the users holding a permission on a project', async ({ assert }) => {
    const team = await Team.create({ name: 'Readers Team' })
    const project = await Project.create({ name: 'Readers Project', teamId: team.id })
    const viewer = await createUser('viewer@example.com')
    const admin = await createUser('admin@example.com')
    const outsider = await createUser('outsider@example.com')
    await grantRole(viewer, 'viewer', { project })
    await grantRole(admin, 'admin')
    await grantRole(outsider, 'developer', { team: await Team.create({ name: 'Other' }) })

    assert.deepEqual(await usersWithPermission(project, 'env.read'), [viewer.id])
    assert.deepEqual(
      await usersWithPermission(project, 'env.read', { name: 'production', protected: true }),
      []
    )
  })
})
