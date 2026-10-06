import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import Environment from '#models/environment'
import EnvironmentKey from '#models/environment_key'
import ProjectKey from '#models/project_key'
import SecretSnapshot from '#models/secret_snapshot'
import { createUser, grantRole } from '#tests/helpers/rbac'

const encryptedData = { ciphertext: 'c', iv: 'i', authTag: 't' }

test.group('Environment keys: push and revocation', () => {
  test('a push to a separated environment uses its key version', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Push version' })
    const project = await Project.create({ name: 'Push version project', teamId: team.id })
    const maintainer = await createUser(`pv-${Math.random()}@example.com`)
    await grantRole(maintainer, 'maintainer', { team })
    await Environment.create({ projectId: project.id, name: 'qa', protected: false, keyVersion: 3 })

    const push = (keyVersion: number) =>
      client
        .post('/api/secrets')
        .loginAs(maintainer)
.json({
          projectId: project.id,
          environment: 'qa',
          cryptoVersion: 2,
          version: 1,
          keyVersion,
          keyScope: 'environment',
          encryptedData,
        })
    const stale = await push(1)
    stale.assertStatus(409)
    const fresh = await push(3)
    fresh.assertStatus(201)
    const snapshot = await SecretSnapshot.query().where('project_id', project.id).firstOrFail()
    assert.equal(snapshot.keyVersion, 3)
  })

  test('a developer turned viewer loses the key of a separated production', async ({
    client,
    assert,
  }) => {
    const team = await Team.create({ name: 'Revocation' })
    const project = await Project.create({ name: 'Revocation project', teamId: team.id })
    const maintainer = await createUser(`rv-m-${Math.random()}@example.com`)
    const developer = await createUser(`rv-d-${Math.random()}@example.com`)
    await grantRole(maintainer, 'maintainer', { team })
    await grantRole(developer, 'developer', { team })
    const production = await Environment.create({
      projectId: project.id,
      name: 'production',
      protected: true,
      keyVersion: 1,
    })
    await EnvironmentKey.create({ environmentId: production.id, userId: developer.id, encryptedKey: 'k' })
    await ProjectKey.create({ projectId: project.id, userId: developer.id, encryptedKey: 'pk' })

    const response = await client
      .patch(`/api/teams/${team.id}/members/${developer.id}`)
      .loginAs(maintainer)
      .json({ roleId: 'role_viewer' })
    response.assertStatus(200)
    assert.deepEqual(response.body().environmentsToRotate, [
      { projectId: project.id, projectName: project.name, environment: 'production' },
    ])
    assert.deepEqual(response.body().projectsToRotate, [])

    await production.refresh()
    assert.isTrue(production.rotationRequired)
    assert.isNull(await EnvironmentKey.query().where('user_id', developer.id).first())
    assert.isNotNull(await ProjectKey.query().where('user_id', developer.id).first())
  })
})
