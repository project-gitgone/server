import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import AuditEvent from '#models/audit_event'
import Environment from '#models/environment'
import Project from '#models/project'
import SecretSnapshot from '#models/secret_snapshot'
import Team from '#models/team'
import { createUser, grantRole } from '#tests/helpers/rbac'

const encrypted = { ciphertext: 'c', iv: 'i', authTag: 't', cryptoVersion: 1, keyVersion: 1 }

async function projectWithHistory() {
  const team = await Team.create({ name: 'Timeline' })
  const project = await Project.create({ name: 'Timeline project', teamId: team.id })
  const author = await createUser(`author-${Math.random()}@example.com`)
  await Environment.create({ projectId: project.id, name: 'development', protected: false })
  await Environment.create({ projectId: project.id, name: 'production', protected: true })
  const at = (minutes: number) => DateTime.fromISO('2026-10-01T10:00:00Z').plus({ minutes })
  const snapshot = (
    environment: string,
    version: number,
    minutes: number,
    rollbackOf: number | null = null
  ) =>
    SecretSnapshot.create({
      projectId: project.id,
      environment,
      version,
      createdBy: author.id,
      rollbackOf,
      createdAt: at(minutes),
      ...encrypted,
    })
  await snapshot('development', 1, 0)
  await snapshot('production', 1, 1)
  await snapshot('production', 2, 2)
  await snapshot('production', 3, 4, 1)
  await AuditEvent.create({
    actorType: 'user',
    actorId: author.id,
    actorLabel: author.email,
    action: 'keys.rotate',
    projectId: project.id,
    environment: null,
    details: { keyVersion: 2 },
    createdAt: at(3),
  })
  await AuditEvent.create({
    actorType: 'user',
    actorId: author.id,
    actorLabel: author.email,
    action: 'keys.rotate',
    projectId: project.id,
    environment: 'production',
    details: { keyVersion: 3 },
    createdAt: at(5),
  })
  return { team, project, author }
}

test.group('Project timeline', () => {
  test('versions, rollbacks and rotations of every environment, newest first', async ({
    client,
    assert,
  }) => {
    const { team, project } = await projectWithHistory()
    const maintainer = await createUser(`maintainer-${Math.random()}@example.com`)
    await grantRole(maintainer, 'maintainer', { team })

    const response = await client.get(`/api/projects/${project.id}/timeline`).loginAs(maintainer)
    response.assertStatus(200)
    const body = response.body()
    assert.deepEqual(body.environments, ['development', 'production'])
    assert.deepEqual(
      body.events.map((event: any) =>
        event.type === 'version'
          ? `${event.environment}@v${event.version}`
          : `${event.type}:${event.environment}`
      ),
      [
        'rotation:production',
        'production@v3',
        'rotation:null',
        'production@v2',
        'production@v1',
        'development@v1',
      ]
    )
    assert.equal(body.events[1].rollbackOf, 1)
    assert.equal(body.events[2].keyVersion, 2)
    assert.isNull(body.nextBefore)
  })

  test('environments without history access are left out', async ({ client, assert }) => {
    const { team, project } = await projectWithHistory()
    const viewer = await createUser(`viewer-${Math.random()}@example.com`)
    await grantRole(viewer, 'viewer', { team })

    const response = await client.get(`/api/projects/${project.id}/timeline`).loginAs(viewer)
    response.assertStatus(200)
    const body = response.body()
    assert.deepEqual(body.environments, ['development'])
    assert.isTrue(
      body.events.every(
        (event: any) => event.environment === 'development' || event.environment === null
      )
    )
    assert.isTrue(
      body.events.some((event: any) => event.type === 'rotation' && event.environment === null)
    )
  })

  test('pages follow each other without overlap', async ({ client, assert }) => {
    const { team, project } = await projectWithHistory()
    const maintainer = await createUser(`maintainer-${Math.random()}@example.com`)
    await grantRole(maintainer, 'maintainer', { team })

    const first = await client
      .get(`/api/projects/${project.id}/timeline`)
      .qs({ limit: 2 })
      .loginAs(maintainer)
    first.assertStatus(200)
    assert.lengthOf(first.body().events, 2)
    assert.isString(first.body().nextBefore)
    const second = await client
      .get(`/api/projects/${project.id}/timeline`)
      .qs({ limit: 2, before: first.body().nextBefore })
      .loginAs(maintainer)
    const seen = [...first.body().events, ...second.body().events].map(
      (event: any) => event.createdAt
    )
    assert.equal(new Set(seen).size, seen.length)
    assert.isTrue(
      second.body().events.every((event: any) => event.createdAt < first.body().nextBefore)
    )
  })

  test('a page cut between versions and markers still points to the next one', async ({
    client,
    assert,
  }) => {
    const { team, project } = await projectWithHistory()
    const maintainer = await createUser(`maintainer-${Math.random()}@example.com`)
    await grantRole(maintainer, 'maintainer', { team })
    const first = await client
      .get(`/api/projects/${project.id}/timeline`)
      .qs({ limit: 5 })
      .loginAs(maintainer)
    assert.lengthOf(first.body().events, 5)
    const second = await client
      .get(`/api/projects/${project.id}/timeline`)
      .qs({ limit: 5, before: first.body().nextBefore })
      .loginAs(maintainer)
    assert.lengthOf(second.body().events, 1)
    assert.equal(second.body().events[0].environment, 'development')
  })

  test('an invalid limit is refused', async ({ client }) => {
    const { team, project } = await projectWithHistory()
    const maintainer = await createUser(`maintainer-${Math.random()}@example.com`)
    await grantRole(maintainer, 'maintainer', { team })
    for (const limit of ['0', '1000', 'abc']) {
      const response = await client
        .get(`/api/projects/${project.id}/timeline`)
        .qs({ limit })
        .loginAs(maintainer)
      response.assertStatus(422)
    }
  })

  test('a rollback push records the restored version', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Rollback' })
    const project = await Project.create({ name: 'Rollback project', teamId: team.id })
    const maintainer = await createUser(`maintainer-${Math.random()}@example.com`)
    await grantRole(maintainer, 'maintainer', { team })
    const push = (extra: Record<string, unknown> = {}) =>
      client
        .post('/api/secrets')
        .loginAs(maintainer)
        .json({
          projectId: project.id,
          environment: 'staging',
          encryptedData: { ciphertext: 'c', iv: 'i', authTag: 't' },
          ...extra,
        })
    const first = await push()
    first.assertStatus(201)
    await push()
    const rollback = await push({ rollbackOf: first.body().id })
    rollback.assertStatus(201)
    const stored = await SecretSnapshot.findOrFail(rollback.body().id)
    assert.equal(stored.rollbackOf, 1)
  })
})
