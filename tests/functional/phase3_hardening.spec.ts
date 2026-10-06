import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import Role from '#models/role'
import RoleAssignment from '#models/role_assignment'
import Environment from '#models/environment'
import EnvironmentKey from '#models/environment_key'
import { keyringReaders, projectKeyring } from '#services/keyring'
import { createUser, grantRole } from '#tests/helpers/rbac'

const encryptedData = { ciphertext: 'c', iv: 'i', authTag: 't' }

async function workspace() {
  const team = await Team.create({ name: 'P3 hardening' })
  const project = await Project.create({ name: 'P3 hardening project', teamId: team.id })
  const maintainer = await createUser(`p3-m-${Math.random()}@example.com`)
  await grantRole(maintainer, 'maintainer', { team })
  const base = (environment: string) => `/api/projects/${project.id}/environments/${environment}/key`
  return { team, project, maintainer, base }
}

const customRole = async (name: string, grants: unknown[]) =>
  Role.create({ name, scope: 'workspace', isSystem: false, grants } as any)

test.group('Phase 3 hardening', () => {
  test('a push encrypted with the project key is refused in a separated environment', async ({
    client,
  }) => {
    const { project, maintainer } = await workspace()
    await Environment.create({ projectId: project.id, name: 'production', protected: true, keyVersion: 1 })

    const push = (extra: Record<string, unknown>) =>
      client
        .post('/api/secrets')
        .loginAs(maintainer)
        .json({ projectId: project.id, environment: 'production', encryptedData, ...extra })
    const oldClient = await push({ cryptoVersion: 2, version: 1, keyVersion: 1 })
    oldClient.assertStatus(409)
    const legacy = await push({})
    legacy.assertStatus(409)
    const current = await push({ cryptoVersion: 2, version: 1, keyVersion: 1, keyScope: 'environment' })
    current.assertStatus(201)
  })

  test('protecting a separated environment revokes the keys of those who lose it', async ({
    client,
    assert,
  }) => {
    const { team, project, maintainer } = await workspace()
    const viewer = await createUser(`p3-v-${Math.random()}@example.com`)
    await grantRole(viewer, 'viewer', { team })
    const staging = await Environment.create({ projectId: project.id, name: 'staging', protected: false, keyVersion: 1 })
    await EnvironmentKey.create({ environmentId: staging.id, userId: viewer.id, encryptedKey: 'k' })

    const response = await client
      .patch(`/api/projects/${project.id}/environments/${staging.id}`)
      .loginAs(maintainer)
      .json({ protected: true })
    response.assertStatus(200)
    assert.deepEqual(response.body().environmentsToRotate, [
      { projectId: project.id, projectName: project.name, environment: 'staging' },
    ])
    assert.isNull(await EnvironmentKey.query().where('user_id', viewer.id).first())
  })

  test('resetting a user removes their environment keys', async ({ client, assert }) => {
    const { project } = await workspace()
    const admin = await createUser(`p3-a-${Math.random()}@example.com`)
    const user = await createUser(`p3-u-${Math.random()}@example.com`)
    await grantRole(admin, 'admin')
    await grantRole(user, 'member')
    const qa = await Environment.create({ projectId: project.id, name: 'qa', protected: false, keyVersion: 1 })
    await EnvironmentKey.create({ environmentId: qa.id, userId: user.id, encryptedKey: 'k' })

    const response = await client.post(`/api/users/${user.id}/reset-credentials`).loginAs(admin)
    response.assertStatus(200)
    assert.isNull(await EnvironmentKey.query().where('user_id', user.id).first())
    await qa.refresh()
    assert.isTrue(qa.rotationRequired)
  })

  test('the project key goes only to readers of environments still using it', async ({
    assert,
  }) => {
    const { project, maintainer } = await workspace()
    const onCall = await createUser(`p3-oc-${Math.random()}@example.com`)
    const role = await customRole('Prod on-call', [
      { permission: 'env.read', environments: { type: 'list', names: ['production'] } },
    ])
    await RoleAssignment.create({ userId: onCall.id, roleId: role.id, scopeType: 'project', scopeId: project.id })
    await Environment.create({ projectId: project.id, name: 'production', protected: true, keyVersion: 1 })
    await Environment.create({ projectId: project.id, name: 'staging', protected: false })

    assert.deepEqual(await keyringReaders(projectKeyring(project)), [maintainer.id])
  })

  test('sharing never replaces a key someone holds, and needs read access to the environment', async ({
    client,
  }) => {
    const { project, maintainer, base } = await workspace()
    const manager = await createUser(`p3-mm-${Math.random()}@example.com`)
    const role = await customRole('Members only', [{ permission: 'project.members.manage' }])
    await RoleAssignment.create({ userId: manager.id, roleId: role.id, scopeType: 'project', scopeId: project.id })
    const production = await Environment.create({ projectId: project.id, name: 'production', protected: true, keyVersion: 1 })
    await EnvironmentKey.create({ environmentId: production.id, userId: maintainer.id, encryptedKey: 'k' })

    const byManager = await client
      .post(`${base('production')}/share`)
      .loginAs(manager)
      .json({ targetUserId: maintainer.id, encryptedKey: 'chosen-key' })
    byManager.assertStatus(403)

    const overwrite = await client
      .post(`${base('production')}/share`)
      .loginAs(maintainer)
      .json({ targetUserId: maintainer.id, encryptedKey: 'other-key' })
    overwrite.assertStatus(409)
  })

  test('initializing an environment requires being able to read it', async ({ client }) => {
    const { project, maintainer, base } = await workspace()
    const writer = await createUser(`p3-w-${Math.random()}@example.com`)
    const role = await customRole('Blind writer', [
      { permission: 'env.write', environments: { type: 'all' } },
    ])
    await RoleAssignment.create({ userId: writer.id, roleId: role.id, scopeType: 'project', scopeId: project.id })

    const response = await client
      .post(`${base('qa')}/rotate`)
      .loginAs(writer)
      .json({ expectedKeyVersion: 0, keys: [{ userId: maintainer.id, encryptedKey: 'k' }], snapshots: [] })
    response.assertStatus(403)
  })
})
