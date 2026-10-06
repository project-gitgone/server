import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import Environment from '#models/environment'
import SecretSnapshot from '#models/secret_snapshot'
import { createUser, grantRole } from '#tests/helpers/rbac'

const encryptedData = { ciphertext: 'c', iv: 'i', authTag: 't' }

test.group('Snapshot retention', () => {
  test('keeps the last N snapshots, including the one just pushed', async ({ client, assert }) => {
    const team = await Team.create({ name: 'Retention' })
    const project = await Project.create({ name: 'Retention project', teamId: team.id })
    const maintainer = await createUser('retention@example.com')
    await grantRole(maintainer, 'maintainer', { team })
    await Environment.create({ projectId: project.id, name: 'development', protected: false, retention: 2 })

    for (let i = 0; i < 4; i++) {
      const response = await client.post('/api/secrets').loginAs(maintainer).json({ projectId: project.id, environment: 'development', encryptedData })
      response.assertStatus(201)
    }
    const versions = await SecretSnapshot.query().where('project_id', project.id).orderBy('version')
    assert.deepEqual(versions.map((s) => s.version), [3, 4])
  })

  test('no retention keeps everything', async ({ client, assert }) => {
    const team = await Team.create({ name: 'No retention' })
    const project = await Project.create({ name: 'No retention project', teamId: team.id })
    const maintainer = await createUser('no-retention@example.com')
    await grantRole(maintainer, 'maintainer', { team })

    for (let i = 0; i < 3; i++) {
      const response = await client.post('/api/secrets').loginAs(maintainer).json({ projectId: project.id, environment: 'development', encryptedData })
      response.assertStatus(201)
    }
    assert.lengthOf(await SecretSnapshot.query().where('project_id', project.id), 3)
  })
})
