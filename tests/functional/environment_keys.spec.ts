import { test } from '@japa/runner'
import hash from '@adonisjs/core/services/hash'
import Team from '#models/team'
import Project from '#models/project'
import Environment from '#models/environment'
import EnvironmentKey from '#models/environment_key'
import ProjectKey from '#models/project_key'
import ProjectToken from '#models/project_token'
import SecretSnapshot from '#models/secret_snapshot'
import { createUser, grantRole } from '#tests/helpers/rbac'

async function workspace() {
  const team = await Team.create({ name: 'Env keys' })
  const project = await Project.create({ name: 'Env keys project', teamId: team.id })
  const maintainer = await createUser(`ek-maintainer-${Math.random()}@example.com`)
  const developer = await createUser(`ek-developer-${Math.random()}@example.com`)
  await grantRole(maintainer, 'maintainer', { team })
  await grantRole(developer, 'developer', { team })
  const base = (environment: string) =>
    `/api/projects/${project.id}/environments/${environment}/key`
  return { team, project, maintainer, developer, base }
}

const keysFor = (users: { id: string }[]) =>
  users.map((u) => ({ userId: u.id, encryptedKey: `k-${u.id}` }))

const token = async (projectId: string, environment: string) =>
  ProjectToken.create({
    name: environment,
    token: await hash.make('v'.repeat(43)),
    cryptoVersion: 2,
    projectId,
    environment,
    encryptedProjectKey: 'k',
  })

test.group('Environment keys', () => {
  test('an inherited environment serves the project key', async ({ client, assert }) => {
    const { project, maintainer, base } = await workspace()
    await Environment.create({ projectId: project.id, name: 'development', protected: false })
    await ProjectKey.create({
      projectId: project.id,
      userId: maintainer.id,
      encryptedKey: 'project-key',
    })

    const response = await client.get(base('development')).loginAs(maintainer)
    response.assertStatus(200)
    assert.include(response.body(), {
      scope: 'project',
      encryptedKey: 'project-key',
      keyVersion: 1,
    })
  })

  test('a developer initializes a new unprotected environment, not a protected one', async ({
    client,
    assert,
  }) => {
    const { project, maintainer, developer, base } = await workspace()

    const recipients = await client.get(`${base('qa')}/recipients`).loginAs(developer)
    recipients.assertStatus(200)
    assert.sameMembers(
      recipients.body().map((u: { id: string }) => u.id),
      [maintainer.id, developer.id]
    )

    const init = await client
      .post(`${base('qa')}/rotate`)
      .loginAs(developer)
      .json({ expectedKeyVersion: 0, keys: keysFor([maintainer, developer]), snapshots: [] })
    init.assertStatus(200)
    const qa = await Environment.query()
      .where('project_id', project.id)
      .where('name', 'qa')
      .firstOrFail()
    assert.equal(qa.keyVersion, 1)

    const mine = await client.get(base('qa')).loginAs(developer)
    mine.assertStatus(200)
    assert.include(mine.body(), {
      scope: 'environment',
      encryptedKey: `k-${developer.id}`,
      keyVersion: 1,
    })

    const production = await client
      .post(`${base('production')}/rotate`)
      .loginAs(developer)
      .json({ expectedKeyVersion: 0, keys: keysFor([maintainer, developer]), snapshots: [] })
    production.assertStatus(403)

    const rotateAgain = await client
      .post(`${base('qa')}/rotate`)
      .loginAs(developer)
      .json({ expectedKeyVersion: 1, keys: keysFor([maintainer, developer]), snapshots: [] })
    rotateAgain.assertStatus(403)
  })

  test('separating an inherited environment takes it out of the project key', async ({
    client,
    assert,
  }) => {
    const { project, maintainer, developer, base } = await workspace()
    await Environment.create({ projectId: project.id, name: 'development', protected: false })
    const snapshot = await SecretSnapshot.create({
      projectId: project.id,
      environment: 'development',
      version: 1,
      ciphertext: 'old',
      iv: 'i',
      authTag: 't',
      createdBy: maintainer.id,
    })

    const exported = await client.get(`${base('development')}/snapshots`).loginAs(maintainer)
    exported.assertStatus(200)
    assert.equal(exported.body().keyVersion, 0)
    assert.deepEqual(
      exported.body().snapshots.map((s: { id: string }) => s.id),
      [snapshot.id]
    )

    const separate = await client
      .post(`${base('development')}/rotate`)
      .loginAs(maintainer)
      .json({
        expectedKeyVersion: 0,
        keys: keysFor([maintainer, developer]),
        snapshots: [{ id: snapshot.id, ciphertext: 'new', iv: 'i2', authTag: 't2' }],
      })
    separate.assertStatus(200)
    await snapshot.refresh()
    assert.equal(snapshot.ciphertext, 'new')
    assert.equal(snapshot.keyVersion, 1)

    const projectExport = await client.get(`/api/keys/${project.id}/snapshots`).loginAs(maintainer)
    projectExport.assertStatus(200)
    assert.lengthOf(projectExport.body().snapshots, 0)
  })

  test('rotating an environment revokes only its tokens', async ({ client, assert }) => {
    const { project, maintainer, developer, base } = await workspace()
    await Environment.create({ projectId: project.id, name: 'qa', protected: false, keyVersion: 1 })
    await Environment.create({ projectId: project.id, name: 'development', protected: false })
    await token(project.id, 'qa')
    const kept = await token(project.id, 'development')

    const rotated = await client
      .post(`${base('qa')}/rotate`)
      .loginAs(maintainer)
      .json({ expectedKeyVersion: 1, keys: keysFor([maintainer, developer]), snapshots: [] })
    rotated.assertStatus(200)
    assert.include(rotated.body(), { keyVersion: 2, revokedTokens: 1 })
    const remaining = await ProjectToken.query().where('project_id', project.id)
    assert.deepEqual(
      remaining.map((t) => t.id),
      [kept.id]
    )
    assert.lengthOf(await EnvironmentKey.all(), 2)
  })

  test('a viewer cannot get the key of a separated protected environment', async ({ client }) => {
    const { team, project, base } = await workspace()
    const viewer = await createUser(`ek-viewer-${Math.random()}@example.com`)
    await grantRole(viewer, 'viewer', { team })
    await Environment.create({
      projectId: project.id,
      name: 'production',
      protected: true,
      keyVersion: 1,
    })

    const response = await client.get(base('production')).loginAs(viewer)
    response.assertStatus(403)
  })
})
