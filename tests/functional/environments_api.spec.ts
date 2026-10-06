import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import SecretSnapshot from '#models/secret_snapshot'
import { createUser, grantRole } from '#tests/helpers/rbac'

test.group('Environments API', () => {
  test('a maintainer creates, lists and protects environments', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Env API' })
    const project = await Project.create({ name: 'Env API project', teamId: team.id })
    const maintainer = await createUser('env-maintainer@example.com')
    await grantRole(maintainer, 'maintainer', { team })

    const created = await client
      .post(`/api/projects/${project.id}/environments`)
      .loginAs(maintainer)
      .json({ name: 'live', protected: true, retention: 10 })
    created.assertStatus(201)
    const duplicate = await client.post(`/api/projects/${project.id}/environments`).loginAs(maintainer).json({ name: 'live' })
    duplicate.assertStatus(409)

    await SecretSnapshot.create({ projectId: project.id, environment: 'live', version: 1, ciphertext: 'c', iv: 'i', authTag: 't', createdBy: maintainer.id })
    const listed = await client.get(`/api/projects/${project.id}/environments`).loginAs(maintainer)
    listed.assertStatus(200)
    const live = listed.body().find((e: any) => e.name === 'live')
    assert.include(live, { protected: true, retention: 10, snapshotCount: 1 })
    assert.isString(live.lastPushAt)

    const updated = await client
      .patch(`/api/projects/${project.id}/environments/${created.body().id}`)
      .loginAs(maintainer)
      .json({ protected: false, retention: null })
    updated.assertStatus(200)
    assert.include(updated.body(), { protected: false, retention: null })
  })

  test('a developer sees environments but cannot change them', async ({ client }) => {
    const team = await Team.create({ name: 'Env API dev' })
    const project = await Project.create({ name: 'Env API dev project', teamId: team.id })
    const dev = await createUser('env-dev@example.com')
    await grantRole(dev, 'developer', { team })

    const listed = await client.get(`/api/projects/${project.id}/environments`).loginAs(dev)
    listed.assertStatus(200)
    const created = await client.post(`/api/projects/${project.id}/environments`).loginAs(dev).json({ name: 'qa' })
    created.assertStatus(403)
  })
})
