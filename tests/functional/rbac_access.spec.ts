import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import Role from '#models/role'
import RoleAssignment from '#models/role_assignment'
import SecretSnapshot from '#models/secret_snapshot'
import ProjectKey from '#models/project_key'
import { createUser, grantRole } from '#tests/helpers/rbac'

const encryptedData = { ciphertext: 'c', iv: 'i', authTag: 't' }

async function workspace() {
  const team = await Team.create({ name: 'Access Team' })
  const project = await Project.create({ name: 'Access Project', teamId: team.id })
  return { team, project }
}

async function snapshot(project: Project, environment: string, createdBy: string) {
  return SecretSnapshot.create({
    projectId: project.id,
    environment,
    version: 1,
    ciphertext: 'c',
    iv: 'i',
    authTag: 't',
    createdBy,
  })
}

test.group('RBAC access to secrets', () => {
  test('a developer pushes to development but not to production', async ({ client }) => {
    const { team, project } = await workspace()
    const dev = await createUser('dev@example.com')
    await grantRole(dev, 'developer', { team })

    const push = (environment: string) =>
      client
        .post('/api/secrets')
        .loginAs(dev)
        .json({ projectId: project.id, environment, encryptedData })
    const response1 = await push('development')
    response1.assertStatus(201)
    const response2 = await push('Production')
    response2.assertStatus(403)
  })

  test('a former member still pulls production', async ({ client }) => {
    const { team, project } = await workspace()
    const dev = await createUser('former-member@example.com')
    await grantRole(dev, 'developer', { team })
    await snapshot(project, 'production', dev.id)

    const response = await client
      .get(`/api/secrets/latest?projectId=${project.id}&env=production`)
      .loginAs(dev)
    response.assertStatus(200)
  })

  test('a viewer pulls staging but not production', async ({ client }) => {
    const { project } = await workspace()
    const viewer = await createUser('viewer@example.com')
    await grantRole(viewer, 'viewer', { project })
    await snapshot(project, 'staging', viewer.id)
    await snapshot(project, 'production', viewer.id)

    const response3 = await client
      .get(`/api/secrets/latest?projectId=${project.id}&env=staging`)
      .loginAs(viewer)
    response3.assertStatus(200)
    const response4 = await client
      .get(`/api/secrets/latest?projectId=${project.id}&env=production`)
      .loginAs(viewer)
    response4.assertStatus(403)
  })

  test('an instance owner without a team role cannot read secrets nor the project key', async ({
    client,
  }) => {
    const { project } = await workspace()
    const owner = await createUser('instance-owner@example.com')
    await grantRole(owner, 'owner')
    await snapshot(project, 'development', owner.id)

    const response5 = await client
      .get(`/api/secrets/latest?projectId=${project.id}&env=development`)
      .loginAs(owner)
    response5.assertStatus(403)
    const response6 = await client.get(`/api/keys/${project.id}`).loginAs(owner)
    response6.assertStatus(403)
  })

  test('a rollback needs env.rollback on top of env.write', async ({ client }) => {
    const { project } = await workspace()
    const writer = await createUser('writer@example.com')
    const role = await Role.create({
      name: 'Writer',
      scope: 'workspace',
      isSystem: false,
      grants: [
        { permission: 'env.read', environments: { type: 'all' } },
        { permission: 'env.write', environments: { type: 'all' } },
      ],
    } as any)
    await RoleAssignment.create({
      userId: writer.id,
      roleId: role.id,
      scopeType: 'project',
      scopeId: project.id,
    })
    const previous = await snapshot(project, 'development', writer.id)

    const push = (rollbackOf?: string) =>
      client
        .post('/api/secrets')
        .loginAs(writer)
        .json({ projectId: project.id, environment: 'development', encryptedData, rollbackOf })
    const response7 = await push(previous.id)
    response7.assertStatus(403)
    const response8 = await push()
    response8.assertStatus(201)
  })

  test('a rollback must point to a snapshot of the same environment', async ({ client }) => {
    const { team, project } = await workspace()
    const maintainer = await createUser('maintainer@example.com')
    await grantRole(maintainer, 'maintainer', { team })
    const other = await snapshot(project, 'staging', maintainer.id)

    const response = await client.post('/api/secrets').loginAs(maintainer).json({
      projectId: project.id,
      environment: 'development',
      encryptedData,
      rollbackOf: other.id,
    })
    response.assertStatus(422)
  })

  test('a CI token needs read access to its environment', async ({ client }) => {
    const { project } = await workspace()
    const manager = await createUser('token-manager@example.com')
    const role = await Role.create({
      name: 'Token manager',
      scope: 'workspace',
      isSystem: false,
      grants: [
        { permission: 'project.tokens.manage' },
        { permission: 'env.read', environments: { type: 'unprotected' } },
      ],
    } as any)
    await RoleAssignment.create({
      userId: manager.id,
      roleId: role.id,
      scopeType: 'project',
      scopeId: project.id,
    })

    const create = (environment: string) =>
      client
        .post(`/api/projects/${project.id}/tokens`)
        .loginAs(manager)
        .json({
          name: 'ci',
          environment,
          authVerifier: 'a'.repeat(43),
          encryptedProjectKey: 'k',
        })
    const response9 = await create('staging')
    response9.assertStatus(201)
    const response10 = await create('production')
    response10.assertStatus(403)
  })

  test('key recipients are the readers of the project, not instance admins', async ({
    client,
    assert,
  }) => {
    const { team, project } = await workspace()
    const maintainer = await createUser('keys-maintainer@example.com')
    const viewer = await createUser('keys-viewer@example.com')
    const admin = await createUser('keys-admin@example.com')
    await grantRole(maintainer, 'maintainer', { team })
    await grantRole(viewer, 'viewer', { project })
    await grantRole(admin, 'admin')
    await ProjectKey.create({ projectId: project.id, userId: maintainer.id, encryptedKey: 'k' })

    const response = await client.get(`/api/keys/${project.id}/recipients`).loginAs(maintainer)
    response.assertStatus(200)
    assert.sameMembers(
      response.body().map((u: { id: string }) => u.id),
      [maintainer.id, viewer.id]
    )
  })
})
