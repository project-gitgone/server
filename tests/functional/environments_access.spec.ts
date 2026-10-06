import { test } from '@japa/runner'
import Team from '#models/team'
import Project from '#models/project'
import Environment from '#models/environment'
import { createUser, grantRole } from '#tests/helpers/rbac'

const encryptedData = { ciphertext: 'c', iv: 'i', authTag: 't' }

async function developerOn() {
  const team = await Team.create({ name: 'Env access' })
  const project = await Project.create({ name: 'Env access project', teamId: team.id })
  const dev = await createUser(`dev-${Math.random()}@example.com`)
  await grantRole(dev, 'developer', { team })
  return { project, dev }
}

test.group('Environment protection', () => {
  test('the stored flag decides, not the name', async ({ client }) => {
    const { project, dev } = await developerOn()
    await Environment.create({ projectId: project.id, name: 'production', protected: false })
    await Environment.create({ projectId: project.id, name: 'live', protected: true })

    const push = (environment: string) =>
      client
        .post('/api/secrets')
        .loginAs(dev)
        .json({ projectId: project.id, environment, encryptedData })
    const production = await push('production')
    production.assertStatus(201)
    const live = await push('live')
    live.assertStatus(403)
  })

  test('a first push creates the environment, except a protected one for a developer', async ({
    client,
    assert,
  }) => {
    const { project, dev } = await developerOn()
    const push = (environment: string) =>
      client
        .post('/api/secrets')
        .loginAs(dev)
        .json({ projectId: project.id, environment, encryptedData })

    const staging = await push('staging')
    staging.assertStatus(201)
    const created = await Environment.query()
      .where('project_id', project.id)
      .where('name', 'staging')
      .first()
    assert.isNotNull(created)
    assert.isFalse(created!.protected)

    const production = await push('production')
    production.assertStatus(403)
    assert.isNull(
      await Environment.query().where('project_id', project.id).where('name', 'production').first()
    )
  })

  test('invalid environment names are refused', async ({ client }) => {
    const { project, dev } = await developerOn()
    const star = await client
      .post('/api/secrets')
      .loginAs(dev)
      .json({ projectId: project.id, environment: '*', encryptedData })
    star.assertStatus(422)
    const latest = await client
      .get(`/api/secrets/latest?projectId=${project.id}&env=*`)
      .loginAs(dev)
    latest.assertStatus(400)
  })
})
